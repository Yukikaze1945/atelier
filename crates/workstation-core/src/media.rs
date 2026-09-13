use crate::model::{id, now, ProjectView};
use crate::store::{decode, encode, sql, Result, Store};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaJob {
    pub id: String,
    pub project_id: String,
    pub project_revision: u64,
    pub status: String,
    pub progress: f64,
    pub output_path: String,
    pub staging_path: String,
    pub profile: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub error: Option<String>,
    pub log_path: String,
    #[serde(default)]
    pub pipeline_audit: Option<Value>,
}
pub struct MediaManager {
    root: PathBuf,
    worker: PathBuf,
    runtime: PathBuf,
    owned: Mutex<Vec<PathBuf>>,
}
impl MediaManager {
    pub fn new(store: &Store) -> Result<Self> {
        sql(store.catalog.execute_batch("CREATE TABLE IF NOT EXISTS media_jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,body TEXT NOT NULL);"))?;
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let worker = std::env::var_os("WORKSTATION_MEDIA_WORKER")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                repo.join(if cfg!(windows) {
                    "native/build/Release/workstation-media-worker.exe"
                } else {
                    "native/build/workstation-media-worker"
                })
            });
        let runtime = std::env::var_os("WORKSTATION_GSTREAMER_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|| repo.join(".deps/gstreamer"));
        Ok(Self {
            root: store.root.clone(),
            worker,
            runtime,
            owned: Mutex::new(vec![]),
        })
    }
    fn command(&self) -> Command {
        worker_command(&self.worker, &self.runtime)
    }
    pub fn capabilities(&self) -> Value {
        if !self.worker.is_file() {
            return json!({"available":false,"renderAvailable":false,"reason":"原生媒体工作进程尚未构建，请运行 npm run build:media","gpuZeroCopy":{"validated":false}});
        }
        match query(self.command().arg("--probe")) {
            Ok(value) => value,
            Err(error) => {
                json!({"available":false,"renderAvailable":false,"reason":error,"gpuZeroCopy":{"validated":false}})
            }
        }
    }
    pub fn inspect(&self, uri: &str) -> Result<Value> {
        query(self.command().args(["--inspect", uri]))
    }
    pub fn plan(&self, project: &ProjectView) -> Result<Value> {
        let timeline = project.project.timeline.as_ref().ok_or("项目没有时间线")?;
        let subtitles =
            crate::subtitles::for_export(&project.project, &Store::new(&self.root)?.plugins()?)?;
        let mut assets = vec![];
        for asset in &project.project.assets {
            let uri = if let Some(relative) = &asset.project_path {
                url::Url::from_file_path(Path::new(&project.directory).join(relative))
                    .map_err(|_| "项目素材路径无效")?
                    .to_string()
            } else {
                asset.source_uri.clone()
            };
            assets.push(json!({"id":asset.id,"revision":asset.revision,"name":asset.name,"mediaType":asset.media_type,"uri":uri}));
        }
        Ok(
            json!({"version":1,"intent":"export","projectId":project.project.id,"projectRevision":project.project.revision,"timeline":timeline,"assets":assets,"subtitles":subtitles,"execution":self.capabilities()}),
        )
    }
    pub fn export(&self, project: &ProjectView, output: &Path, profile: &str) -> Result<MediaJob> {
        if !["mp4-h264", "webm-vp8"].contains(&profile) {
            return Err("不支持的输出编码预设".into());
        }
        let mut plan = self.plan(project)?;
        if plan["execution"]["renderAvailable"] != true {
            return Err(format!(
                "CAPABILITY_UNAVAILABLE：{}",
                plan["execution"]["reason"]
                    .as_str()
                    .unwrap_or("原生渲染不可用")
            ));
        }
        let timeline = project.project.timeline.as_ref().unwrap();
        if timeline.clips.is_empty() {
            return Err("时间线没有可导出的片段".into());
        }
        if !output.is_absolute() || output.file_name().is_none() {
            return Err("请选择完整的导出文件路径".into());
        }
        if output.exists() {
            return Err("输出文件已存在，请选择新名称；不会覆盖已有文件".into());
        }
        let parent = output.parent().ok_or("输出目录无效")?;
        if !parent.is_dir() {
            return Err("输出目录不存在".into());
        }
        let job_id = id();
        let job_dir = self.root.join("media-jobs").join(&job_id);
        std::fs::create_dir_all(&job_dir).map_err(|e| e.to_string())?;
        let owner = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(job_dir.join("owner.lock"))
            .map_err(|e| e.to_string())?;
        owner.lock().map_err(|e| e.to_string())?;
        let staging = parent.join(format!(
            ".{}.{}.partial",
            output.file_name().unwrap().to_string_lossy(),
            job_id
        ));
        let cancellation = job_dir.join("cancel");
        plan["profile"] = json!(profile);
        let plan_file = job_dir.join("plan.json");
        std::fs::write(&plan_file, encode(&plan)?).map_err(|e| e.to_string())?;
        let job = MediaJob {
            id: job_id,
            project_id: project.project.id.clone(),
            project_revision: project.project.revision,
            status: "queued".into(),
            progress: 0.0,
            output_path: output.to_string_lossy().into(),
            staging_path: staging.to_string_lossy().into(),
            profile: profile.into(),
            created_at: now(),
            updated_at: now(),
            error: None,
            log_path: job_dir.join("worker.log").to_string_lossy().into(),
            pipeline_audit: None,
        };
        save_job(&self.root, &job)?;
        self.owned
            .lock()
            .map_err(|_| "任务锁失效")?
            .push(cancellation.clone());
        let (root, worker, runtime, copy) = (
            self.root.clone(),
            self.worker.clone(),
            self.runtime.clone(),
            job.clone(),
        );
        std::thread::spawn(move || {
            let _owner = owner;
            let mut job = copy;
            if let Err(error) = run_job(
                &root,
                &worker,
                &runtime,
                &plan_file,
                &cancellation,
                &mut job,
            ) {
                job.status = "failed".into();
                job.error = Some(error);
                job.updated_at = now();
                let _ = save_job(&root, &job);
            }
        });
        Ok(job)
    }
    pub fn jobs(&self, project_id: Option<&str>) -> Result<Vec<MediaJob>> {
        let conn = job_connection(&self.root)?;
        let mut stmt=sql(conn.prepare("SELECT body FROM media_jobs WHERE (?1 IS NULL OR project_id=?1) ORDER BY rowid DESC LIMIT 100"))?;
        let rows = sql(stmt.query_map([project_id], |r| r.get::<_, String>(0)))?;
        let mut jobs: Vec<MediaJob> = rows.map(|r| decode(&sql(r)?)).collect::<Result<_>>()?;
        drop(stmt);
        for job in &mut jobs {
            if !["queued", "running", "cancelling"].contains(&job.status.as_str()) {
                continue;
            }
            let lock = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(
                    self.root
                        .join("media-jobs")
                        .join(&job.id)
                        .join("owner.lock"),
                );
            if let Ok(lock) = lock {
                if lock.try_lock().is_ok() {
                    job.status = "interrupted".into();
                    job.error =
                        Some("导出任务的所属 Core 已退出，临时文件保留，可重新提交导出。".into());
                    job.updated_at = now();
                    save_job(&self.root, job)?;
                }
            }
        }
        Ok(jobs)
    }
    pub fn cancel(&self, job_id: &str) -> Result<MediaJob> {
        let conn = job_connection(&self.root)?;
        let body: String = sql(conn.query_row(
            "SELECT body FROM media_jobs WHERE id=?",
            [job_id],
            |r| r.get(0),
        ))?;
        let mut job: MediaJob = decode(&body)?;
        if ["queued", "running", "cancelling"].contains(&job.status.as_str()) {
            std::fs::write(
                self.root.join("media-jobs").join(job_id).join("cancel"),
                b"cancel",
            )
            .map_err(|e| e.to_string())?;
            job.status = "cancelling".into();
        }
        Ok(job)
    }
}
impl Drop for MediaManager {
    fn drop(&mut self) {
        if let Ok(paths) = self.owned.lock() {
            for path in paths.iter() {
                let _ = std::fs::write(path, b"owner exited");
            }
        }
    }
}
fn worker_command(worker: &Path, runtime: &Path) -> Command {
    let mut cmd = Command::new(worker);
    let mut paths = vec![runtime.join("bin")];
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    if let Ok(path) = std::env::join_paths(paths) {
        cmd.env("PATH", path);
    }
    if runtime.is_dir() {
        cmd.env(
            "GST_PLUGIN_SYSTEM_PATH_1_0",
            runtime.join("lib/gstreamer-1.0"),
        );
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    cmd
}
fn query(command: &mut Command) -> Result<Value> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("无法启动媒体进程：{e}"))?;
    let stdout = child.stdout.take().unwrap();
    let reader = std::thread::spawn(move || {
        BufReader::new(stdout)
            .lines()
            .map_while(std::result::Result::ok)
            .filter_map(|line| serde_json::from_str::<Value>(&line).ok())
            .last()
    });
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if start.elapsed() > Duration::from_secs(30) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("媒体探测超时".into());
        }
        std::thread::sleep(Duration::from_millis(30));
    };
    let result = reader
        .join()
        .map_err(|_| "媒体响应读取失败")?
        .ok_or_else(|| format!("媒体进程未返回有效响应（{status}）；请检查运行库"))?;
    if !status.success() || result["event"] == "error" {
        return Err(result["message"].as_str().unwrap_or("媒体操作失败").into());
    }
    Ok(result)
}
fn job_connection(root: &Path) -> Result<Connection> {
    let conn = sql(Connection::open(root.join("catalog.sqlite")))?;
    sql(conn.busy_timeout(Duration::from_secs(5)))?;
    Ok(conn)
}
fn save_job(root: &Path, job: &MediaJob) -> Result<()> {
    let conn = job_connection(root)?;
    sql(conn.execute("INSERT INTO media_jobs(id,project_id,body) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET body=excluded.body",params![job.id,job.project_id,encode(job)?]))?;
    Ok(())
}
struct RunningChild(std::process::Child);
impl std::ops::Deref for RunningChild {
    type Target = std::process::Child;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl std::ops::DerefMut for RunningChild {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}
impl Drop for RunningChild {
    fn drop(&mut self) {
        // A failed job-state write must not leave the renderer running without an owner.
        if matches!(self.0.try_wait(), Ok(None)) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
}
fn run_job(
    root: &Path,
    worker: &Path,
    runtime: &Path,
    plan: &Path,
    cancellation: &Path,
    job: &mut MediaJob,
) -> Result<()> {
    let log = std::fs::File::create(&job.log_path).map_err(|e| e.to_string())?;
    let mut child = RunningChild(
        worker_command(worker, runtime)
            .arg("--render")
            .arg(plan)
            .arg(&job.staging_path)
            .arg(cancellation)
            .arg(std::process::id().to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::from(log))
            .spawn()
            .map_err(|e| format!("媒体工作进程启动失败：{e}"))?,
    );
    let stdout = child.stdout.take().unwrap();
    let (send, receive) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout)
            .lines()
            .map_while(std::result::Result::ok)
        {
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                if send.send(value).is_err() {
                    break;
                }
            }
        }
    });
    job.status = "running".into();
    save_job(root, job)?;
    let mut terminal = None;
    let mut saved = Instant::now();
    let status = loop {
        while let Ok(event) = receive.try_recv() {
            if let Some(progress) = event["progress"].as_f64() {
                job.progress = progress.clamp(0.0, 0.999);
            }
            match event["event"].as_str() {
                Some("pipeline-audit") => job.pipeline_audit = Some(event),
                Some("error") => {
                    job.error = Some(event["message"].as_str().unwrap_or("媒体错误").into())
                }
                Some("complete") => terminal = Some("complete"),
                Some("cancelled") => terminal = Some("cancelled"),
                _ => {}
            }
        }
        if saved.elapsed() >= Duration::from_millis(250) {
            job.status = if cancellation.exists() {
                "cancelling"
            } else {
                "running"
            }
            .into();
            job.updated_at = now();
            save_job(root, job)?;
            saved = Instant::now();
        }
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    for event in receive.iter() {
        match event["event"].as_str() {
            Some("pipeline-audit") => job.pipeline_audit = Some(event),
            Some("complete") => terminal = Some("complete"),
            Some("cancelled") => terminal = Some("cancelled"),
            Some("error") => {
                job.error = Some(event["message"].as_str().unwrap_or("媒体错误").into())
            }
            _ => {}
        }
    }
    if terminal == Some("cancelled") || (cancellation.exists() && terminal != Some("complete")) {
        job.status = "cancelled".into();
    } else if status.success() && terminal == Some("complete") {
        // Same-directory hard linking is atomic and never replaces an existing user file.
        std::fs::hard_link(&job.staging_path, &job.output_path)
            .map_err(|e| format!("保存目标失败，临时成片已保留：{e}"))?;
        let _ = std::fs::remove_file(&job.staging_path);
        job.status = "completed".into();
        job.progress = 1.0;
    } else {
        job.status = "failed".into();
        if job.error.is_none() {
            job.error = Some(format!(
                "媒体进程异常退出：{status}；日志：{}",
                job.log_path
            ));
        }
    }
    job.updated_at = now();
    save_job(root, job)
}
