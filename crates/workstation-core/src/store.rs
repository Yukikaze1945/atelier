use crate::model::*;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::path::{Path, PathBuf};

pub type Result<T> = std::result::Result<T, String>;
pub fn sql<T>(result: rusqlite::Result<T>) -> Result<T> {
    result.map_err(|e| format!("项目数据库：{e}"))
}
pub fn encode<T: serde::Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|e| e.to_string())
}
pub fn decode<T: serde::de::DeserializeOwned>(s: &str) -> Result<T> {
    serde_json::from_str(s).map_err(|e| format!("无法读取数据：{e}"))
}

pub struct Store {
    pub catalog: Connection,
    pub root: PathBuf,
}
impl Store {
    pub fn new(root: &Path) -> Result<Self> {
        std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
        let catalog = sql(Connection::open(root.join("catalog.sqlite")))?;
        sql(catalog.busy_timeout(std::time::Duration::from_secs(5)))?;
        sql(catalog.execute_batch("PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, directory TEXT NOT NULL UNIQUE);
            CREATE TABLE IF NOT EXISTS templates(id TEXT PRIMARY KEY, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS plugins(id TEXT PRIMARY KEY, body TEXT NOT NULL);"))?;
        Ok(Self {
            catalog,
            root: root.to_path_buf(),
        })
    }
    pub fn project_directory(&self, id: &str) -> Result<PathBuf> {
        sql(self
            .catalog
            .query_row("SELECT directory FROM projects WHERE id=?", [id], |r| {
                r.get::<_, String>(0)
            }))
        .map(PathBuf::from)
    }
    pub fn connection(&self, id: &str) -> Result<Connection> {
        let file = self.project_directory(id)?.join("project.sqlite");
        if !file.is_file() {
            return Err("项目目录已离线或移动，请重新定位打开".into());
        }
        let connection = sql(Connection::open_with_flags(
            file,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE,
        ))?;
        sql(connection.busy_timeout(std::time::Duration::from_secs(5)))?;
        Ok(connection)
    }
    pub fn register(&self, project: &Project, directory: &Path) -> Result<()> {
        sql(self.catalog.execute("INSERT INTO projects(id,directory) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET directory=excluded.directory", params![project.id, directory.to_string_lossy()]))?;
        Ok(())
    }
    pub fn create(&self, project: &Project, directory: &Path) -> Result<ProjectView> {
        validate_project(project)?;
        std::fs::create_dir(directory)
            .map_err(|e| format!("无法创建项目目录（不能覆盖已有目录）：{e}"))?;
        let conn = sql(Connection::open(directory.join("project.sqlite")))?;
        sql(conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
            CREATE TABLE document(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE history(seq INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, before_body TEXT NOT NULL, after_body TEXT NOT NULL);"))?;
        sql(conn.execute(
            "INSERT INTO document(id,body,cursor) VALUES(1,?1,0)",
            [encode(project)?],
        ))?;
        self.register(project, directory)?;
        self.get(&project.id)
    }
    pub fn get(&self, id: &str) -> Result<ProjectView> {
        let conn = self.connection(id)?;
        let (body, cursor): (String, i64) = sql(conn.query_row(
            "SELECT body,cursor FROM document WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ))?;
        let mut project: Project = decode(&body)?;
        crate::subtitles::refresh_ports(&mut project, &self.plugins()?);
        validate_project(&project)?;
        let can_redo = sql(conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM history WHERE seq>?)",
            [cursor],
            |r| r.get(0),
        ))?;
        Ok(ProjectView {
            project,
            directory: self.project_directory(id)?.to_string_lossy().into(),
            can_undo: cursor > 0,
            can_redo,
        })
    }
    pub fn open_directory(&self, directory: &Path) -> Result<ProjectView> {
        let directory = directory.canonicalize().map_err(|e| e.to_string())?;
        let file = directory.join("project.sqlite");
        if !file.is_file() {
            return Err("所选目录不包含工作站 project.sqlite".into());
        }
        let conn = sql(Connection::open_with_flags(
            file,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ))?;
        let body: String =
            sql(conn.query_row("SELECT body FROM document WHERE id=1", [], |r| r.get(0)))?;
        let project: Project = decode(&body)?;
        validate_project(&project)?;
        self.register(&project, &directory)?;
        self.get(&project.id)
    }
    pub fn mutate<F>(&self, id: &str, expected: u64, label: &str, apply: F) -> Result<ProjectView>
    where
        F: FnOnce(&mut Project) -> Result<()>,
    {
        let mut conn = self.connection(id)?;
        let tx = sql(conn.transaction_with_behavior(TransactionBehavior::Immediate))?;
        let (body, cursor): (String, i64) = sql(tx.query_row(
            "SELECT body,cursor FROM document WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ))?;
        let mut project: Project = decode(&body)?;
        if project.revision != expected {
            return Err("REVISION_CONFLICT：工程已被其他页面或 Agent 修改，请刷新后重试".into());
        }
        crate::subtitles::refresh_ports(&mut project, &self.plugins()?);
        apply(&mut project)?;
        validate_project(&project)?;
        project.revision += 1;
        project.modified_at = now();
        let after = encode(&project)?;
        sql(tx.execute("DELETE FROM history WHERE seq>?", [cursor]))?;
        sql(tx.execute(
            "INSERT INTO history(label,before_body,after_body) VALUES(?1,?2,?3)",
            params![label, body, after],
        ))?;
        let new_cursor = tx.last_insert_rowid();
        sql(tx.execute(
            "UPDATE document SET body=?1,cursor=?2 WHERE id=1",
            params![after, new_cursor],
        ))?;
        sql(tx.commit())?;
        self.get(id)
    }
    pub fn history(&self, id: &str, expected: u64, redo: bool) -> Result<ProjectView> {
        let mut conn = self.connection(id)?;
        let tx = sql(conn.transaction_with_behavior(TransactionBehavior::Immediate))?;
        let (body, cursor): (String, i64) = sql(tx.query_row(
            "SELECT body,cursor FROM document WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ))?;
        let current: Project = decode(&body)?;
        if current.revision != expected {
            return Err("REVISION_CONFLICT：工程已改变，请刷新后重试".into());
        }
        let query = if redo {
            "SELECT seq,after_body FROM history WHERE seq>? ORDER BY seq LIMIT 1"
        } else {
            "SELECT seq,before_body FROM history WHERE seq=?"
        };
        let entry: Option<(i64, String)> = sql(tx
            .query_row(query, [cursor], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional())?;
        let (seq, next_body) = entry.ok_or("没有可撤销或重做的操作")?;
        let mut next: Project = decode(&next_body)?;
        next.revision = current.revision + 1;
        next.modified_at = now();
        let next_cursor = if redo {
            seq
        } else {
            sql(tx.query_row(
                "SELECT COALESCE(MAX(seq),0) FROM history WHERE seq<?",
                [seq],
                |r| r.get(0),
            ))?
        };
        sql(tx.execute(
            "UPDATE document SET body=?1,cursor=?2 WHERE id=1",
            params![encode(&next)?, next_cursor],
        ))?;
        sql(tx.commit())?;
        self.get(id)
    }
    pub fn plugins(&self) -> Result<Vec<Plugin>> {
        let mut result = vec![Plugin {
            manifest: builtin_manifest(),
            directory: None,
            enabled: true,
            builtin: true,
            installed_at: 0,
        }];
        let mut stmt = sql(self.catalog.prepare("SELECT body FROM plugins ORDER BY id"))?;
        let rows = sql(stmt.query_map([], |r| r.get::<_, String>(0)))?;
        for row in rows {
            let plugin: Plugin = decode(&sql(row)?)?;
            if plugin.builtin {
                result.retain(|p| p.manifest.id != plugin.manifest.id);
            }
            result.push(plugin);
        }
        Ok(result)
    }
    pub fn save_plugin(&self, plugin: &Plugin) -> Result<()> {
        sql(self.catalog.execute("INSERT INTO plugins(id,body) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET body=excluded.body",params![plugin.manifest.id,encode(plugin)?]))?;
        Ok(())
    }
}
