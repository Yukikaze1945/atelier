import { useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleDashed,
  FileJson,
  RefreshCw,
  Rocket,
} from "lucide-react";
import { useProject } from "../context";
import { host } from "../host";
import { Button, secondsLabel } from "./ui";
import { VideoSettingsDialog } from "./VideoSettings";
import { subtitleInputs } from "../subtitles";

interface MediaCapabilities {
  renderAvailable: boolean;
  version?: string;
  reason?: string;
  profiles?: string[];
}
interface MediaJob {
  id: string;
  status: string;
  progress: number;
  projectRevision: number;
  outputPath: string;
  error?: string;
  logPath: string;
  pipelineAudit?: {
    usesSystemMemoryCompositor: boolean;
    elements: unknown[];
  } | null;
}

export function ExportPage() {
  const { project, notify, plugins } = useProject();
  const subtitleSources = [
    ...new Map(
      project.workspace.pages
        .filter((n) =>
          ["builtin:edit", "builtin:export"].includes(n.definition.renderer),
        )
        .flatMap((n) => subtitleInputs(project, n.id, plugins))
        .map((s) => [s.nodeId, s]),
    ).values(),
  ];
  const [plan, setPlan] = useState<unknown>();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [capabilities, setCapabilities] = useState<MediaCapabilities>();
  const [profile, setProfile] = useState("mp4-h264");
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    host
      .request<MediaCapabilities>("media.capabilities")
      .then((c) => {
        if (alive) setCapabilities(c);
      })
      .catch((e) => notify(e.message));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    const poll = () =>
      host
        .request<MediaJob[]>("media.jobs", { projectId: project.id })
        .then((list) => {
          if (alive) setJobs(list);
        })
        .catch((e) => {
          if (alive) notify(e.message);
        });
    void poll();
    const timer = setInterval(poll, 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [project.id]);
  async function exportVideo() {
    setBusy(true);
    try {
      const outputPath = await host.request<string | null>("dialog.export", {
        profile,
        defaultPath: `${project.name}.${profile === "webm-vp8" ? "webm" : "mp4"}`,
      });
      if (outputPath) {
        const job = await host.request<MediaJob>("media.export", {
          projectId: project.id,
          expectedRevision: project.revision,
          outputPath,
          profile,
        });
        setJobs((previous) => [
          job,
          ...previous.filter((j) => j.id !== job.id),
        ]);
        notify("已提交 GES 导出任务。");
      }
    } catch (error) {
      notify(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function inspect() {
    setBusy(true);
    try {
      setPlan(await host.request("media.plan", { projectId: project.id }));
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy(false);
    }
  }
  const duration = project.timeline
    ? Math.max(
        0,
        ...project.timeline.clips.map(
          (c) => (c.startTicks + c.durationTicks) / project.timeline!.timebase,
        ),
      )
    : 0;
  return (
    <div className="export-page">
      {settingsOpen && (
        <VideoSettingsDialog onClose={() => setSettingsOpen(false)} />
      )}
      <section className="export-intro">
        <div className="eyebrow">DELIVERY</div>
        <div className="export-symbol">
          <Rocket size={34} />
        </div>
        <h1>渲染与导出</h1>
        <p>
          {subtitleSources.length
            ? `已连接 ${subtitleSources.length} 条字幕输出，共 ${subtitleSources.reduce((n, s) => n + s.cues.length, 0)} 条字幕；本次烧录到视频画面。`
            : "未连接字幕输出，本次不烧录字幕。"}
        </p>
        <p>
          导出页已经连接当前项目。
          <br />
          使用独立 GES/GStreamer 工作进程导出当前时间线快照。
        </p>
        <div className="export-facts">
          <div>
            <span>时间线</span>
            <strong>{project.timeline?.name || "未创建"}</strong>
          </div>
          <div>
            <span>总时长</span>
            <strong>{secondsLabel(duration)}</strong>
          </div>
          <div>
            <span>片段数</span>
            <strong>{project.timeline?.clips.length || 0}</strong>
          </div>
        </div>
      </section>
      <section className="export-status">
        <h3>媒体链路状态</h3>
        <div className="check-row">
          <CheckCircle2 size={19} />
          <div>
            <strong>项目与时间线契约</strong>
            <p>由 Rust Core 保存，页面与 Agent 共享。</p>
          </div>
          <span>已连接</span>
        </div>
        <div className="check-row">
          <CheckCircle2 size={19} />
          <div>
            <strong>执行计划生成</strong>
            <p>包含素材引用、时基、轨道和片段信息。</p>
          </div>
          <span>可用</span>
        </div>
        <div
          className={`check-row ${capabilities?.renderAvailable ? "" : "pending"}`}
        >
          {capabilities?.renderAvailable ? (
            <CheckCircle2 size={19} />
          ) : (
            <CircleDashed size={19} />
          )}
          <div>
            <strong>GES / GStreamer 原生媒体工作进程</strong>
            <p>
              {capabilities?.renderAvailable
                ? `${capabilities.version} · 独立进程、任务进度与取消`
                : capabilities?.reason || "正在检测媒体工作进程…"}
            </p>
          </div>
          <span>{capabilities?.renderAvailable ? "已连接" : "不可用"}</span>
        </div>
        <div className="check-row pending">
          <CircleDashed size={19} />
          <div>
            <strong>AI 模型与高级滤镜</strong>
            <p>通过各自插件提供模型、运行环境和参数。</p>
          </div>
          <span>待接入</span>
        </div>
        <div className="export-buttons">
          <Button
            onClick={() => setSettingsOpen(true)}
            disabled={!project.timeline}
          >
            视频设置
          </Button>
          <select
            aria-label="导出编码预设"
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
          >
            <option value="mp4-h264">MP4 · H.264 / AAC（CPU 编码）</option>
            <option value="webm-vp8">WebM · VP8 / Vorbis</option>
          </select>
          <Button onClick={inspect} disabled={busy || !project.timeline}>
            <RefreshCw size={15} />
            {busy ? "生成中…" : "生成媒体执行计划"}
          </Button>
          {plan !== undefined && (
            <Button onClick={() => setShow(!show)}>
              <FileJson size={15} />
              {show ? "收起计划" : "查看计划"}
            </Button>
          )}
          <Button
            className="primary"
            disabled={
              busy ||
              !capabilities?.renderAvailable ||
              !duration ||
              !capabilities.profiles?.includes(profile)
            }
            onClick={exportVideo}
          >
            开始导出
          </Button>
        </div>
        {plan !== undefined && (
          <p className="success-text">
            执行计划已生成，导出任务单独显示在下方。
          </p>
        )}
        {show && (
          <pre className="plan-json">{JSON.stringify(plan, null, 2)}</pre>
        )}
        <div aria-label="导出任务列表" style={{ marginTop: 24 }}>
          {jobs.map((job) => (
            <div className="check-row" key={job.id}>
              <div>
                <strong>
                  {(
                    {
                      queued: "排队中",
                      running: "导出中",
                      cancelling: "正在取消",
                      cancelled: "已取消",
                      completed: "已完成",
                      failed: "失败",
                      interrupted: "已中断",
                    } as Record<string, string>
                  )[job.status] || job.status}{" "}
                  · {Math.round(job.progress * 100)}%
                </strong>
                <p>{job.outputPath}</p>
                <small className="muted">工程版本 {job.projectRevision}</small>
                {job.pipelineAudit && (
                  <details style={{ marginTop: 10 }}>
                    <summary>
                      实际媒体管线 ·{" "}
                      {job.pipelineAudit.usesSystemMemoryCompositor
                        ? "系统内存合成"
                        : "查看内存协商"}
                    </summary>
                    <pre className="plan-json">
                      {JSON.stringify(job.pipelineAudit, null, 2)}
                    </pre>
                  </details>
                )}
                {job.error && (
                  <p className="warning-text">
                    {job.error}
                    <br />
                    日志：{job.logPath}
                  </p>
                )}
                <progress
                  style={{ width: "100%" }}
                  max={1}
                  value={job.progress}
                />
              </div>
              {["queued", "running", "cancelling"].includes(job.status) && (
                <Button
                  onClick={() =>
                    host
                      .request("media.cancel", { jobId: job.id })
                      .catch((e) => notify(e.message))
                  }
                >
                  取消任务
                </Button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
