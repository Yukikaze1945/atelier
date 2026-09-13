import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Plus,
  Play,
  Pause,
  SkipBack,
  Scissors,
  Trash2,
  ZoomIn,
  ZoomOut,
  Film,
  ArrowRight,
  Settings2,
  PanelsTopLeft,
  PanelLeft,
  PanelRight,
  LockKeyhole,
  UnlockKeyhole,
  Eye,
  EyeOff,
} from "lucide-react";
import type { Asset, Clip, PageNode, Timeline } from "../../packages/sdk/src";
import { useProject } from "../context";
import { host } from "../host";
import { AssetThumbnail, MediaPreview, useAssetUrl } from "./MediaPage";
import { Button, Empty, Glyph, IconButton, secondsLabel } from "./ui";
import { VideoSettingsDialog } from "./VideoSettings";
import { GpuPreviewDialog } from "./GpuPreviewDialog";
import { TimelineMedia, type TimelineClock } from "./TimelineMedia";
import { subtitleInputs, type SubtitleLane } from "../subtitles";
import {
  TimelineContextMenu,
  type TimelineMenuItem,
} from "./TimelineContextMenu";

export function EditPage({ node }: { node: PageNode }) {
  const { project, command, openPage, notify, plugins } = useProject();
  const subtitleLanes = useMemo(
    () => subtitleInputs(project, node.id, plugins),
    [project, node.id, plugins],
  );
  const timeline = project.timeline;
  const hasLegacyOverlaps = useMemo(
    () =>
      timeline?.clips.some((a, i, clips) =>
        clips
          .slice(i + 1)
          .some(
            (b) =>
              a.trackId === b.trackId &&
              a.startTicks < b.startTicks + b.durationTicks &&
              b.startTicks < a.startTicks + a.durationTicks,
          ),
      ) ?? false,
    [timeline],
  );
  const [selected, setSelected] = useState<string>();
  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [seekVersion, setSeekVersion] = useState(0);
  const clockRef = useRef<TimelineClock | null>(null);
  const registerClock = useCallback(
    (clipId: string, element: HTMLMediaElement | null) => {
      if (element) clockRef.current = { clipId, element };
      else if (clockRef.current?.clipId === clipId) clockRef.current = null;
    },
    [],
  );
  const failPlayback = useCallback(
    (message: string) => {
      setPlaying(false);
      notify(message);
    },
    [notify],
  );
  const seekTo = useCallback((position: number) => {
    setPlaying(false);
    setSeconds(position);
    setSeekVersion((v) => v + 1);
  }, []);
  const [zoom, setZoom] = useState(65);
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    const handle = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (action === "settings") setSettingsOpen(true);
      if (action === "play") setPlaying((v) => !v);
      if (action === "start") seekTo(0);
    };
    window.addEventListener("editor.action", handle);
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input,textarea,select,button,[contenteditable=true]"))
        return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("editor.action", handle);
      window.removeEventListener("keydown", key);
    };
  }, [seekTo]);
  const [gpuOpen, setGpuOpen] = useState(false);
  const [showBin, setShowBin] = useState(true);
  const [showSource, setShowSource] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [sourceId, setSourceId] = useState<string>();
  const [restoring, setRestoring] = useState(false);
  const sourceAsset = project.assets.find((asset) => asset.id === sourceId);
  const sourceUrl = useAssetUrl(project.id, sourceAsset);
  const duration = timeline
    ? Math.max(
        0,
        ...timeline.clips.map(
          (c) => (c.startTicks + c.durationTicks) / timeline.timebase,
        ),
      )
    : 0;
  const assets = project.assets.filter(
    (a) =>
      !a.archived &&
      ["video", "audio", "image"].includes(a.mediaType) &&
      a.name.toLowerCase().includes(query.toLowerCase()),
  );
  const clip = timeline?.clips.find((c) => c.id === selected);
  const previewSeconds =
    !playing && duration > 0 && seconds >= duration
      ? Math.max(0, duration - 0.000001)
      : seconds;
  const active =
    timeline?.clips.filter(
      (c) =>
        !c.disabled &&
        c.startTicks / timeline.timebase <= previewSeconds &&
        (c.startTicks + c.durationTicks) / timeline.timebase > previewSeconds,
    ) || [];
  const visuals = active
    .slice()
    .reverse()
    .filter(
      (c) =>
        timeline?.tracks.find((t) => t.id === c.trackId && !t.disabled)
          ?.kind === "video",
    )
    .sort(
      (a, b) =>
        timeline!.tracks.findIndex((t) => t.id === a.trackId) -
        timeline!.tracks.findIndex((t) => t.id === b.trackId),
    );
  const visual = visuals[0];
  const audio = active.filter((c) =>
    timeline?.tracks.some(
      (t) =>
        t.id === c.trackId &&
        t.kind === "audio" &&
        !t.muted &&
        !t.disabled &&
        (!timeline.tracks.some((t) => t.kind === "audio" && t.solo) || t.solo),
    ),
  );
  const masterClip =
    visual &&
    project.assets.find((a) => a.id === visual.assetId)?.mediaType === "video"
      ? visual
      : audio[0];
  const playheadRef = useRef(seconds);
  playheadRef.current = seconds;
  useEffect(() => {
    if (!playing) return;
    let frameId = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const elapsed = (now - previous) / 1000;
      previous = now;
      let next = playheadRef.current;
      if (masterClip && timeline) {
        const clock = clockRef.current;
        if (
          clock?.clipId === masterClip.id &&
          clock.element.readyState >= 2 &&
          !clock.element.seeking
        ) {
          const end =
            (masterClip.startTicks + masterClip.durationTicks) /
            timeline.timebase;
          next = clock.element.ended
            ? end
            : Math.min(
                end,
                masterClip.startTicks / timeline.timebase +
                  clock.element.currentTime -
                  masterClip.inTicks / timeline.timebase,
              );
        }
      } else next += elapsed;
      next = Math.max(0, Math.min(duration, next));
      playheadRef.current = next;
      setSeconds(next);
      if (next >= duration) {
        setPlaying(false);
        return;
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [
    playing,
    duration,
    masterClip?.id,
    masterClip?.startTicks,
    masterClip?.inTicks,
    masterClip?.durationTicks,
    timeline?.timebase,
  ]);
  async function add(asset: Asset) {
    const next = await command({
      type: "timeline.add",
      assetId: asset.id,
      trackId: asset.mediaType === "audio" ? "a1" : "v1",
    });
    const added = next?.timeline?.clips.at(-1);
    if (added && next?.timeline) {
      setSelected(added.id);
      seekTo(added.startTicks / next.timeline.timebase);
    }
  }
  function togglePlay() {
    if (!duration) return;
    if (seconds >= duration) {
      setSeconds(0);
      setSeekVersion((v) => v + 1);
    }
    setPlaying((p) => !p);
  }
  const frame = timeline
    ? Math.floor(
        ((seconds % 1) * timeline.frameRate.numerator) /
          timeline.frameRate.denominator,
      )
    : 0;
  const timecode = `${Math.floor(seconds / 3600)
    .toString()
    .padStart(
      2,
      "0",
    )}:${secondsLabel(seconds)}:${frame.toString().padStart(2, "0")}`;
  if (!timeline)
    return (
      <Empty
        icon="timeline"
        title="此项目还没有时间线"
        action={
          <Button
            className="primary"
            onClick={() => command({ type: "timeline.create" })}
          >
            <Plus size={15} />
            创建时间线
          </Button>
        }
      >
        可以创建一条时间线，或继续使用其他页面处理素材。
      </Empty>
    );
  return (
    <div className="edit-page">
      {settingsOpen && (
        <VideoSettingsDialog onClose={() => setSettingsOpen(false)} />
      )}
      {gpuOpen && (
        <GpuPreviewDialog
          assetId={
            project.assets.find(
              (a) =>
                a.id === (clip?.assetId || visual?.assetId) &&
                a.mediaType === "video",
            )?.id
          }
          onClose={() => setGpuOpen(false)}
        />
      )}
      <div className="edit-workspace-toolbar">
        <button aria-pressed={showBin} onClick={() => setShowBin(!showBin)}>
          <PanelLeft size={16} />
          媒体池
        </button>
        <button
          aria-pressed={showSource}
          onClick={() => setShowSource(!showSource)}
        >
          <PanelsTopLeft size={16} />
          双监看器
        </button>
        <div className="spacer" />
        <span className="workspace-mode">{project.name}</span>
        <div className="spacer" />
        <button
          aria-pressed={showInspector}
          onClick={() => setShowInspector(!showInspector)}
        >
          <PanelRight size={16} />
          检查器
        </button>
      </div>
      <div
        className="edit-upper"
        style={{
          gridTemplateColumns: `${showBin ? "180px " : ""}${showSource ? "minmax(0,1fr) " : ""}minmax(0,1fr)${showInspector ? " 210px" : ""}`,
        }}
      >
        {showBin && (
          <aside className="edit-bin">
            <div className="pane-heading">
              <Glyph name="library" size={15} />
              项目素材
              <span className="spacer" />
              {assets.length}
            </div>
            <input
              className="bin-search"
              aria-label="剪辑页搜索素材"
              placeholder="搜索素材"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="edit-assets">
              {assets.slice(0, 100).map((asset) => (
                <div
                  className="edit-asset"
                  key={asset.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(
                      "application/x-workstation-asset",
                      asset.id,
                    );
                    e.currentTarget.dataset.draggingAsset = asset.id;
                  }}
                  onDragEnd={(e) => {
                    delete e.currentTarget.dataset.draggingAsset;
                    window.dispatchEvent(new Event("editor.dragEnd"));
                  }}
                >
                  <div className="edit-asset-thumb">
                    <AssetThumbnail asset={asset} projectId={project.id} />
                  </div>
                  <button
                    className="edit-asset-name"
                    title={asset.name}
                    onClick={() => {
                      setSourceId(asset.id);
                      setShowSource(true);
                    }}
                  >
                    {asset.name}
                  </button>
                  <IconButton
                    label={`将${asset.name}加入时间线`}
                    onClick={() => add(asset)}
                  >
                    <Plus size={15} />
                  </IconButton>
                </div>
              ))}
            </div>
            {!assets.length && (
              <div className="bin-empty">
                <p>还没有视频、音频或图片。</p>
                <Button
                  onClick={() => {
                    const media = project.workspace.pages.find(
                      (n) => n.definition.type === "media",
                    );
                    if (media) openPage(media.id);
                  }}
                >
                  前往素材页
                  <ArrowRight size={13} />
                </Button>
              </div>
            )}
            <p className="helper muted small">
              拖动素材到下方轨道，或点击 + 添加。
            </p>
          </aside>
        )}
        {showSource && (
          <section className="source-monitor" aria-label="源监看器">
            <div className="pane-heading">
              源监看器
              <div className="spacer" />
              <span className="source-name">{sourceAsset?.name || ""}</span>
            </div>
            <div className="timeline-screen">
              <MediaPreview
                url={sourceUrl}
                kind={sourceAsset?.mediaType || "video"}
                name={sourceAsset?.name || "从媒体池选择源素材"}
              />
            </div>
            <div className="transport">
              <span className="small muted">
                {sourceAsset
                  ? (
                      {
                        image: "图片源",
                        video: "视频源",
                        audio: "音频源",
                      } as Record<string, string>
                    )[sourceAsset.mediaType] || "源素材"
                  : "源素材"}
              </span>
              <span className="small muted">
                {typeof sourceAsset?.metadata.duration === "number"
                  ? secondsLabel(sourceAsset.metadata.duration)
                  : "在媒体池点选素材以预览"}
              </span>
            </div>
          </section>
        )}
        <section className="timeline-monitor">
          <div className="pane-heading">
            {timeline.name}
            <div className="spacer" />
            <IconButton
              label="时间线视频设置"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={15} />
            </IconButton>
            <Button
              onClick={() => {
                setPlaying(false);
                setGpuOpen(true);
              }}
            >
              GPU 验证
            </Button>
            <span className="small muted">
              {timeline.width} × {timeline.height} ·{" "}
              {Number(
                (
                  timeline.frameRate.numerator / timeline.frameRate.denominator
                ).toFixed(3),
              )}{" "}
              fps
            </span>
          </div>
          <div className="timeline-screen">
            <div className="subtitle-preview-overlay">
              {subtitleLanes.flatMap((l) =>
                l.cues
                  .filter(
                    (c) =>
                      c.startTicks / l.timebase <= seconds &&
                      c.endTicks / l.timebase > seconds,
                  )
                  .map((c) => <div key={`${l.nodeId}-${c.id}`}>{c.text}</div>),
              )}
            </div>
            {visual ? (
              (() => {
                const asset = project.assets.find(
                  (a) => a.id === visual.assetId,
                );
                return asset ? (
                  <TimelineMedia
                    key={visual.id}
                    asset={asset}
                    muted={
                      Boolean(visual.linkGroup) ||
                      Boolean(
                        timeline.tracks.find((t) => t.id === visual.trackId)
                          ?.muted,
                      ) ||
                      timeline.tracks.some((t) => t.kind === "audio" && t.solo)
                    }
                    clip={visual}
                    timeline={timeline}
                    seconds={previewSeconds}
                    seekVersion={seekVersion}
                    onFailure={failPlayback}
                    registerClock={
                      masterClip?.id === visual.id ? registerClock : undefined
                    }
                    playing={playing}
                    projectId={project.id}
                  />
                ) : null;
              })()
            ) : (
              <div className="preview-placeholder">
                <Film size={33} />
                <span>{timeline.clips.length ? "空白区间" : "时间线预览"}</span>
              </div>
            )}
            {audio.map((c) => {
              const a = project.assets.find((a) => a.id === c.assetId);
              return a ? (
                <TimelineMedia
                  key={c.id}
                  asset={a}
                  audioOnly
                  clip={c}
                  timeline={timeline}
                  seconds={previewSeconds}
                  seekVersion={seekVersion}
                  onFailure={failPlayback}
                  registerClock={
                    masterClip?.id === c.id ? registerClock : undefined
                  }
                  playing={playing}
                  projectId={project.id}
                />
              ) : null;
            })}
          </div>
          <div className="transport">
            <span className="timecode">{timecode}</span>
            <div>
              <IconButton
                label="回到开头"
                onClick={() => {
                  seekTo(0);
                }}
              >
                <SkipBack size={17} />
              </IconButton>
              <IconButton
                label={playing ? "暂停时间线" : "播放时间线"}
                disabled={!duration}
                onClick={togglePlay}
              >
                {playing ? <Pause size={19} /> : <Play size={19} />}
              </IconButton>
            </div>
            <span className="small muted">兼容预览</span>
          </div>
        </section>
        {showInspector && (
          <aside className="clip-inspector">
            <div className="pane-heading">检查器</div>
            {clip ? (
              <div className="inspector-body">
                <Glyph name="video" size={26} />
                <h3>{clip.name}</h3>
                {["video", "audio"].includes(
                  project.assets.find((a) => a.id === clip.assetId)
                    ?.mediaType || "",
                ) && (
                  <Button
                    disabled={restoring}
                    onClick={async () => {
                      setRestoring(true);
                      try {
                        const next = await command({
                          type: "timeline.restoreSource",
                          clipId: clip.id,
                        });
                        const restored = next?.timeline?.clips.find(
                          (c) => c.id === clip.id,
                        );
                        if (restored && next?.timeline)
                          seekTo(restored.startTicks / next.timeline.timebase);
                      } finally {
                        setRestoring(false);
                      }
                    }}
                  >
                    {restoring ? "正在读取源时长…" : "恢复完整源时长"}
                  </Button>
                )}
                {[
                  ["startTicks", "时间线起点"],
                  ["inTicks", "素材入点"],
                  ["durationTicks", "持续时间"],
                ].map(([key, label]) => (
                  <label key={`${clip.id}-${key}-${project.revision}`}>
                    {label}
                    <div className="number-field">
                      <input
                        aria-label={label}
                        type="number"
                        min={key === "durationTicks" ? 0.001 : 0}
                        step={0.1}
                        defaultValue={(
                          clip[key as "startTicks"] / timeline.timebase
                        ).toFixed(3)}
                        onBlur={(e) => {
                          const value = Math.round(
                            Number(e.target.value) * timeline.timebase,
                          );
                          if (value !== clip[key as "startTicks"])
                            void command({
                              type: "timeline.update",
                              clipId: clip.id,
                              [key]: value,
                            });
                        }}
                      />
                      <span>秒</span>
                    </div>
                  </label>
                ))}
                <p className="asset-id">
                  Clip ID
                  <br />
                  {clip.id}
                </p>
              </div>
            ) : (
              <div className="inspector-empty">
                <Glyph name="timeline" size={24} />
                <p>选择片段调整位置与时长</p>
              </div>
            )}
          </aside>
        )}
      </div>
      <div className="timeline-tools">
        <button
          className="button"
          onClick={() => command({ type: "timeline.trackAdd", kind: "video" })}
        >
          ＋ 视频轨道
        </button>
        <button
          className="button"
          onClick={() => command({ type: "timeline.trackAdd", kind: "audio" })}
        >
          ＋ 音频轨道
        </button>
        {hasLegacyOverlaps && (
          <button
            className="button"
            title="按后放入的片段优先，裁掉同轨被覆盖区间并归档；可撤销"
            onClick={() => command({ type: "timeline.resolveOverlaps" })}
          >
            修复旧同轨重叠
          </button>
        )}
        <span className="timeline-tab">
          <Glyph name="timeline" size={15} />
          {timeline.name}
        </span>
        <div className="tool-divider" />
        <IconButton
          label="在播放头分割片段"
          disabled={!clip}
          onClick={() =>
            clip &&
            command({
              type: "timeline.split",
              clipId: clip.id,
              atTicks: Math.round(seconds * timeline.timebase),
            })
          }
        >
          <Scissors size={16} />
        </IconButton>
        <IconButton
          label="移除片段并归档"
          disabled={!clip}
          onClick={() =>
            clip && command({ type: "timeline.remove", clipId: clip.id })
          }
        >
          <Trash2 size={16} />
        </IconButton>
        <button
          className="button"
          aria-pressed={Boolean(node.config.snap)}
          title="片段首尾与播放头双向吸附"
          onClick={() =>
            command({
              type: "workspace.configure",
              nodeId: node.id,
              config: { ...node.config, snap: !node.config.snap },
            })
          }
        >
          {node.config.snap ? "磁吸开启" : "磁吸关闭"}
        </button>
        <div className="spacer" />
        <ZoomOut size={14} />
        <input
          aria-label="时间线缩放"
          type="range"
          min={15}
          max={160}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
        />
        <ZoomIn size={14} />
        <span className="duration-label">
          {timeline.clips.length} 片段 · {secondsLabel(duration)}
        </span>
      </div>
      <TimelineCanvas
        subtitleLanes={subtitleLanes}
        timeline={timeline}
        selected={selected}
        setSelected={setSelected}
        seconds={seconds}
        seek={seekTo}
        zoom={zoom}
        snap={Boolean(node.config.snap)}
      />
    </div>
  );
}

function TimelineCanvas({
  subtitleLanes,
  timeline,
  selected,
  setSelected,
  seconds,
  seek,
  zoom,
  snap,
}: {
  timeline: Timeline;
  selected?: string;
  setSelected: (id?: string) => void;
  seconds: number;
  seek: (s: number) => void;
  zoom: number;
  snap: boolean;
  subtitleLanes: SubtitleLane[];
}) {
  const { command, project, openPage } = useProject();
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    trackId?: string;
    clipId?: string;
    at: number;
  }>();
  const [linkSelection, setLinkSelection] = useState(true);
  const clipboard = useRef<Clip[]>([]);
  const [snapLine, setSnapLine] = useState<number>();
  const [dropPreview, setDropPreview] = useState<{
    assetId: string;
    start: number;
    y: number;
  }>();
  useEffect(() => {
    const clear = () => setDropPreview(undefined);
    window.addEventListener("editor.dragEnd", clear);
    return () => window.removeEventListener("editor.dragEnd", clear);
  }, []);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(1000);
  const [scroll, setScroll] = useState(0);
  const [drag, setDrag] = useState<{
    clip: Clip;
    startX: number;
    currentX: number;
    currentY?: number;
    startY?: number;
    targetTicks?: number;
    commitRevision?: number;
  } | null>(null);
  const scrubbing = useRef(false);
  const committing = useRef(false);
  useEffect(() => {
    if (
      drag?.targetTicks !== undefined &&
      project.revision > (drag.commitRevision ?? project.revision)
    ) {
      setDrag(null);
    }
  }, [project.revision, drag]);
  const labelWidth = 220,
    rowHeight = 76,
    rulerHeight = 76 + subtitleLanes.length * 56,
    height = rulerHeight + (timeline.tracks.length + 1) * rowHeight;
  const length = Math.max(
    20,
    ...timeline.clips.map(
      (c) => (c.startTicks + c.durationTicks) / timeline.timebase + 8,
    ),
  );
  const selectedClip = timeline.clips.find((c) => c.id === selected);
  const copyClip = (clip: Clip) => {
    clipboard.current = timeline.clips
      .filter(
        (c) =>
          c.id === clip.id ||
          (linkSelection && clip.linkGroup && c.linkGroup === clip.linkGroup),
      )
      .map((c) => ({ ...c, extensions: { ...c.extensions } }));
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable=true],[role=menu]",
        )
      )
        return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === "v" && clipboard.current.length) {
        e.preventDefault();
        void command({
          type: "timeline.paste",
          clips: clipboard.current,
          atTicks: Math.round(seconds * timeline.timebase),
        });
        return;
      }
      if (!selectedClip) return;
      if (!ctrl && e.key.toLowerCase() === "d") {
        e.preventDefault();
        void command({
          type: "timeline.update",
          clipId: selectedClip.id,
          disabled: !selectedClip.disabled,
          linked: linkSelection,
        });
        return;
      }
      if (ctrl && ["c", "x"].includes(e.key.toLowerCase())) {
        e.preventDefault();
        copyClip(selectedClip);
        if (e.key.toLowerCase() === "x")
          void command({
            type: "timeline.remove",
            clipId: selectedClip.id,
            linked: linkSelection,
          });
        return;
      }
      if (
        !ctrl &&
        !e.altKey &&
        ["Backspace", "Delete", "x", "X"].includes(e.key)
      ) {
        e.preventDefault();
        void command({
          type:
            e.shiftKey && e.key === "Backspace"
              ? "timeline.rippleRemove"
              : "timeline.remove",
          clipId: selectedClip.id,
          linked: linkSelection,
        });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selectedClip, seconds, timeline, linkSelection, command]);
  function magnetic(raw: number, moving?: Clip) {
    let value = Math.max(0, raw),
      guide: number | undefined;
    if (snap) {
      const targets = [
        0,
        ...(moving ? [seconds] : []),
        ...timeline.clips
          .filter(
            (c) =>
              !moving ||
              (c.id !== moving.id &&
                (!moving.linkGroup || c.linkGroup !== moving.linkGroup)),
          )
          .flatMap((c) => [
            c.startTicks / timeline.timebase,
            (c.startTicks + c.durationTicks) / timeline.timebase,
          ]),
      ];
      let best = 13 / zoom;
      for (const target of targets)
        for (const offset of moving
          ? [0, moving.durationTicks / timeline.timebase]
          : [0]) {
          const delta = target - (value + offset);
          if (Math.abs(delta) < best && value + delta >= 0) {
            best = Math.abs(delta);
            guide = target;
          }
        }
      if (guide !== undefined) {
        const offsets = moving
          ? [0, moving.durationTicks / timeline.timebase]
          : [0];
        const offset = offsets.reduce((a, b) =>
          Math.abs(value + b - guide!) < Math.abs(value + a - guide!) ? b : a,
        );
        value = guide - offset;
      } else {
        const fps =
          timeline.frameRate.numerator / timeline.frameRate.denominator;
        value = Math.round(value * fps) / fps;
      }
    }
    setSnapLine(guide);
    return value;
  }
  function context(e: React.MouseEvent, trackId?: string, header = false) {
    e.preventDefault();
    const { x, y } = coordinates(e);
    const tr =
      trackId || timeline.tracks[Math.floor((y - rulerHeight) / rowHeight)]?.id;
    const at = Math.max(0, (x - labelWidth + scroll) / zoom);
    const hit =
      !header && x >= labelWidth
        ? timeline.clips
            .slice()
            .reverse()
            .find(
              (c) =>
                c.trackId === tr &&
                c.startTicks / timeline.timebase <= at &&
                (c.startTicks + c.durationTicks) / timeline.timebase > at,
            )
        : undefined;
    if (hit) setSelected(hit.id);
    setMenu({ x: e.clientX, y: e.clientY, trackId: tr, clipId: hit?.id, at });
  }
  function menuItems(): TimelineMenuItem[] {
    if (!menu) return [];
    const track = timeline.tracks.find((t) => t.id === menu.trackId),
      clip = timeline.clips.find((c) => c.id === menu.clipId);
    const run = (type: string, params: Record<string, unknown> = {}) => {
      void command({ type, ...params });
    };
    const items: TimelineMenuItem[] = [];
    if (clip) {
      const locked = Boolean(track?.locked);
      items.push(
        { label: "复制  ·  Ctrl+C", action: () => copyClip(clip) },
        {
          label: "剪切  ·  Ctrl+X",
          disabled: locked,
          action: () => {
            copyClip(clip);
            run("timeline.remove", { clipId: clip.id, linked: linkSelection });
          },
        },
        {
          label: "删除所选  ·  Backspace / X",
          disabled: locked,
          action: () =>
            run("timeline.remove", { clipId: clip.id, linked: linkSelection }),
        },
        {
          label: "波纹删除（关联轨道）  ·  Shift+Backspace",
          disabled: locked,
          action: () =>
            run("timeline.rippleRemove", {
              clipId: clip.id,
              linked: linkSelection,
            }),
        },
        {
          label: clip.disabled ? "启用片段  ·  D" : "禁用片段  ·  D",
          disabled: locked,
          action: () =>
            run("timeline.update", {
              clipId: clip.id,
              disabled: !clip.disabled,
              linked: linkSelection,
            }),
        },
        {
          label: "在播放头分割",
          disabled:
            locked ||
            seconds * timeline.timebase <= clip.startTicks ||
            seconds * timeline.timebase >= clip.startTicks + clip.durationTicks,
          action: () =>
            run("timeline.split", {
              clipId: clip.id,
              atTicks: Math.round(seconds * timeline.timebase),
              linked: linkSelection,
            }),
        },
        {
          label: "更改片段时长…",
          disabled: locked,
          field: {
            label: "持续时间（秒）",
            value: String(clip.durationTicks / timeline.timebase),
            save: (value) =>
              run("timeline.update", {
                clipId: clip.id,
                durationTicks: Math.round(Number(value) * timeline.timebase),
                linked: linkSelection,
              }),
          },
        },
        {
          label: "重命名片段…",
          disabled: locked,
          field: {
            label: "片段名称",
            value: clip.name,
            save: (name) =>
              run("timeline.update", {
                clipId: clip.id,
                name,
                linked: linkSelection,
              }),
          },
        },
        {
          label: "恢复完整源时长",
          disabled:
            locked ||
            project.assets.find((a) => a.id === clip.assetId)?.mediaType ===
              "image",
          action: () =>
            run("timeline.restoreSource", {
              clipId: clip.id,
              linked: linkSelection,
            }),
        },
        {
          label: `${linkSelection ? "✓ " : ""}关联选择 / 编辑`,
          action: () => setLinkSelection(!linkSelection),
        },
      );
      for (const [label, color] of [
        ["蓝色", "#467b9f"],
        ["绿色", "#418562"],
        ["紫色", "#806293"],
        ["橙色", "#a77741"],
      ])
        items.push({
          label: `片段颜色 · ${label}`,
          disabled: locked,
          action: () =>
            run("timeline.update", {
              clipId: clip.id,
              color,
              linked: linkSelection,
            }),
        });
    } else {
      items.push(
        {
          label: "添加视频轨道",
          action: () => run("timeline.trackAdd", { kind: "video" }),
        },
        {
          label: "添加音频轨道",
          action: () => run("timeline.trackAdd", { kind: "audio" }),
        },
      );
      if (track) {
        const index = timeline.tracks.findIndex((t) => t.id === track.id);
        items.push(
          {
            label: "上移轨道",
            disabled: timeline.tracks[index - 1]?.kind !== track.kind,
            action: () =>
              run("timeline.trackMove", { trackId: track.id, direction: "up" }),
          },
          {
            label: "下移轨道",
            disabled: timeline.tracks[index + 1]?.kind !== track.kind,
            action: () =>
              run("timeline.trackMove", {
                trackId: track.id,
                direction: "down",
              }),
          },
          {
            label: "重命名轨道…",
            field: {
              label: "轨道名称",
              value: track.name,
              save: (name) =>
                run("timeline.trackUpdate", { trackId: track.id, name }),
            },
          },
          {
            label: track.locked ? "解锁轨道" : "锁定轨道",
            action: () =>
              run("timeline.trackUpdate", {
                trackId: track.id,
                locked: !track.locked,
              }),
          },
          {
            label: "删除轨道并归档内容",
            disabled: track.locked,
            action: () => run("timeline.trackRemove", { trackId: track.id }),
          },
        );
        if (track.kind === "audio")
          items.push(
            {
              label: track.muted ? "取消静音" : "静音",
              action: () =>
                run("timeline.trackUpdate", {
                  trackId: track.id,
                  muted: !track.muted,
                }),
            },
            {
              label: track.solo ? "取消独听" : "独听",
              action: () =>
                run("timeline.trackUpdate", {
                  trackId: track.id,
                  solo: !track.solo,
                }),
            },
          );
        else
          items.push({
            label: track.disabled ? "启用视频轨道" : "关闭视频轨道",
            action: () =>
              run("timeline.trackUpdate", {
                trackId: track.id,
                disabled: !track.disabled,
              }),
          });
        for (const [label, color] of [
          ["蓝色", "#467b9f"],
          ["绿色", "#418562"],
          ["紫色", "#806293"],
        ])
          items.push({
            label: `轨道颜色 · ${label}`,
            action: () =>
              run("timeline.trackUpdate", { trackId: track.id, color }),
          });
      }
      items.push({
        label: "删除空白轨道",
        action: () => run("timeline.removeEmptyTracks"),
      });
    }
    items.push({
      label: "粘贴到此处  ·  Ctrl+V",
      disabled: !clipboard.current.length,
      action: () =>
        run("timeline.paste", {
          clips: clipboard.current,
          atTicks: Math.round(menu.at * timeline.timebase),
        }),
    });
    return items;
  }
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(entries[0].contentRect.width),
    );
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = width * dpr;
    el.height = height * dpr;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    const ctx = el.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#242429";
    ctx.fillRect(0, 0, width, height);
    ctx.font = '11px "Segoe UI", sans-serif';
    ctx.fillStyle =
      drag &&
      (drag.currentY ?? 100) > 32 &&
      (drag.currentY ?? 100) < rulerHeight
        ? "#40586b"
        : "#29292f";
    ctx.fillRect(labelWidth, 32, width - labelWidth, rulerHeight - 32);
    ctx.fillStyle = "#96969c";
    ctx.fillText(
      "↑ 拖到这里新建视频轨道（关联音轨一起创建）",
      labelWidth + 12,
      58,
    );
    const step = zoom < 30 ? 5 : zoom < 75 ? 2 : 1;
    for (
      let s = Math.floor(scroll / zoom / step) * step;
      s < length;
      s += step
    ) {
      const x = labelWidth + s * zoom - scroll;
      if (x < labelWidth) continue;
      if (x > width) break;
      ctx.strokeStyle = "#35353b";
      ctx.beginPath();
      ctx.moveTo(x, 24);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.fillStyle = "#89898e";
      ctx.fillText(secondsLabel(s), x + 5, 17);
    }
    timeline.tracks.forEach((track, i) => {
      const y = rulerHeight + i * rowHeight;
      ctx.fillStyle = i % 2 ? "#29292f" : "#26262c";
      ctx.fillRect(labelWidth, y, width - labelWidth, rowHeight - 1);
      for (const clip of timeline.clips.filter((c) => c.trackId === track.id)) {
        let x =
          labelWidth + (clip.startTicks / timeline.timebase) * zoom - scroll;
        if (
          drag &&
          (drag.clip.id === clip.id ||
            (linkSelection &&
              drag.clip.linkGroup &&
              drag.clip.linkGroup === clip.linkGroup))
        )
          x =
            labelWidth +
            (drag.targetTicks !== undefined
              ? (drag.targetTicks / timeline.timebase) * zoom
              : Math.max(
                  0,
                  (drag.clip.startTicks / timeline.timebase) * zoom +
                    drag.currentX -
                    drag.startX,
                )) -
            scroll;
        const w = (clip.durationTicks / timeline.timebase) * zoom;
        if (x + w < labelWidth || x > width) continue;
        ctx.save();
        ctx.beginPath();
        ctx.rect(labelWidth, y, width - labelWidth, rowHeight);
        ctx.clip();
        ctx.fillStyle = clip.disabled
          ? "#49494e"
          : clip.color ||
            track.color ||
            (track.kind === "audio" ? "#418562" : "#467b9f");
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 8, Math.max(3, w - 2), rowHeight - 16, 2);
        ctx.fill();
        if (
          selected === clip.id ||
          (linkSelection &&
            clip.linkGroup &&
            timeline.clips.find((c) => c.id === selected)?.linkGroup ===
              clip.linkGroup)
        ) {
          ctx.strokeStyle = "#dddddf";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.fillStyle = track.kind === "audio" ? "#79b391" : "#78a4c0";
        ctx.fillRect(x + 1, y + 8, Math.max(3, w - 2), 1);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 7, y + 16, Math.max(0, w - 14), 40);
        ctx.clip();
        ctx.fillStyle = "#ededee";
        ctx.fillText(
          `${clip.linkGroup ? "↔ " : ""}${clip.name}`,
          x + 9,
          y + 32,
        );
        ctx.fillStyle = "#c7d2d6";
        ctx.fillText(
          `${(clip.durationTicks / timeline.timebase).toFixed(1)}s`,
          x + 9,
          y + 50,
        );
        ctx.restore();
        ctx.restore();
      }
      ctx.fillStyle = "#202024";
      ctx.fillRect(0, y, labelWidth, rowHeight);
      ctx.fillStyle = "#c7c7cc";
      ctx.fillText(track.name, 18, y + 29);
      ctx.fillStyle = "#96969c";
      ctx.fillText(
        track.kind === "audio" ? "音频轨道" : "视频轨道",
        18,
        y + 48,
      );
    });
    ctx.fillStyle = "#202024";
    ctx.fillRect(0, 0, labelWidth, rulerHeight);
    subtitleLanes.forEach((lane, index) => {
      const y = 76 + index * 56;
      ctx.fillStyle = "#25252c";
      ctx.fillRect(labelWidth, y, width - labelWidth, 55);
      for (const cue of lane.cues) {
        const x = labelWidth + (cue.startTicks / lane.timebase) * zoom - scroll,
          w = ((cue.endTicks - cue.startTicks) / lane.timebase) * zoom;
        if (x + w < labelWidth || x > width) continue;
        ctx.save();
        ctx.beginPath();
        ctx.rect(labelWidth, y, width - labelWidth, 56);
        ctx.clip();
        ctx.fillStyle = "#857346";
        ctx.fillRect(x, y + 6, Math.max(3, w - 1), 43);
        ctx.beginPath();
        ctx.rect(x + 5, y + 8, Math.max(0, w - 10), 38);
        ctx.clip();
        ctx.fillStyle = "#f0e8d2";
        ctx.fillText(cue.text, x + 6, y + 30);
        ctx.restore();
      }
    });
    if (dropPreview) {
      const asset = project.assets.find((a) => a.id === dropPreview.assetId);
      if (asset) {
        const row = Math.floor((dropPreview.y - rulerHeight) / rowHeight);
        const y = row < 0 ? 32 : rulerHeight + row * rowHeight;
        const x = labelWidth + dropPreview.start * zoom - scroll;
        const duration = Number(asset.metadata.duration) || 5;
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = asset.mediaType === "audio" ? "#63bb89" : "#72a8d5";
        ctx.fillRect(
          x,
          y + 5,
          Math.max(25, duration * zoom),
          row < 0 ? 38 : rowHeight - 10,
        );
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#b9d7ee";
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(
          x,
          y + 5,
          Math.max(25, duration * zoom),
          row < 0 ? 38 : rowHeight - 10,
        );
        ctx.fillStyle = "#fff";
        ctx.fillText(asset.name, x + 8, y + 25);
        ctx.restore();
      }
    }
    if (snapLine !== undefined) {
      const sx = labelWidth + snapLine * zoom - scroll;
      if (sx >= labelWidth) {
        ctx.save();
        ctx.strokeStyle = "#ffd17c";
        ctx.setLineDash([5, 3]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, height);
        ctx.stroke();
        ctx.restore();
      }
    }
    const x = labelWidth + seconds * zoom - scroll;
    if (x >= labelWidth && x <= width) {
      ctx.strokeStyle = "#e65340";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.fillStyle = "#e65340";
      ctx.beginPath();
      ctx.moveTo(x - 5, 0);
      ctx.lineTo(x + 5, 0);
      ctx.lineTo(x + 5, 12);
      ctx.lineTo(x, 17);
      ctx.lineTo(x - 5, 12);
      ctx.fill();
    }
  }, [
    timeline,
    width,
    height,
    scroll,
    zoom,
    seconds,
    selected,
    drag,
    snapLine,
    linkSelection,
    dropPreview,
    subtitleLanes,
  ]);
  function coordinates(event: { clientX: number; clientY: number }) {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function down(e: React.PointerEvent) {
    if (e.button !== 0 || committing.current) return;
    const { x, y } = coordinates(e);
    if (x < labelWidth) return;
    e.preventDefault();
    setMenu(undefined);
    if (y < 32) {
      scrubbing.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      seek(magnetic((x - labelWidth + scroll) / zoom));
      return;
    }
    const track = timeline.tracks[Math.floor((y - rulerHeight) / rowHeight)];
    const at = (x - labelWidth + scroll) / zoom;
    const clip =
      track &&
      timeline.clips
        .slice()
        .reverse()
        .find(
          (c) =>
            c.trackId === track.id &&
            c.startTicks / timeline.timebase <= at &&
            (c.startTicks + c.durationTicks) / timeline.timebase >= at,
        );
    if (clip) {
      if (track.locked) return;
      setSelected(clip.id);
      setDrag({ clip, startX: x, currentX: x, startY: y, currentY: y });
      e.currentTarget.setPointerCapture(e.pointerId);
    } else {
      setSelected(undefined);
      seek(magnetic(at));
    }
  }
  async function up(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (scrubbing.current) {
      scrubbing.current = false;
      seek(magnetic((coordinates(e).x - labelWidth + scroll) / zoom));
      setSnapLine(undefined);
      return;
    }
    if (committing.current) return;
    if (!drag) return;
    const dx = coordinates(e).x - drag.startX;
    const y = coordinates(e).y;
    if (Math.abs(dx) < 3 && Math.abs(y - (drag.startY ?? y)) < 6) {
      setDrag(null);
      return;
    }
    const position = magnetic(
      drag.clip.startTicks / timeline.timebase + dx / zoom,
      drag.clip,
    );
    const targetTicks = Math.max(0, Math.round(position * timeline.timebase));
    const originTrack = timeline.tracks.find(
      (t) => t.id === drag.clip.trackId,
    )!;
    const target = timeline.tracks[Math.floor((y - rulerHeight) / rowHeight)];
    const newTrack =
      (originTrack.kind === "video" && y < rulerHeight) ||
      (originTrack.kind === "audio" &&
        y >= rulerHeight + timeline.tracks.length * rowHeight);
    if (
      !newTrack &&
      (!target || target.kind !== originTrack.kind || target.locked)
    ) {
      setDrag(null);
      setSnapLine(undefined);
      return;
    }
    committing.current = true;
    setDrag({ ...drag, targetTicks, commitRevision: project.revision });
    try {
      const result = await command({
        type: "timeline.moveToTrack",
        clipId: drag.clip.id,
        startTicks: targetTicks,
        trackId: target?.id,
        newTrack,
        linked: linkSelection,
      });
      if (!result) setDrag(null);
    } catch {
      setDrag(null);
    } finally {
      committing.current = false;
      setSnapLine(undefined);
    }
  }
  async function drop(e: React.DragEvent) {
    e.preventDefault();
    setDropPreview(undefined);
    const assetId = e.dataTransfer.getData("application/x-workstation-asset");
    if (!assetId) return;
    const { x, y } = coordinates(e);
    let track = timeline.tracks[Math.floor((y - rulerHeight) / rowHeight)];
    const asset = project.assets.find((a) => a.id === assetId);
    if (
      !track &&
      asset &&
      (y < rulerHeight || y >= rulerHeight + timeline.tracks.length * rowHeight)
    ) {
      const kind = asset.mediaType === "audio" ? "audio" : "video";
      const created = await command({ type: "timeline.trackAdd", kind });
      track = created?.timeline?.tracks.filter((t) => t.kind === kind)[
        kind === "video"
          ? 0
          : created.timeline.tracks.filter((t) => t.kind === kind).length - 1
      ]!;
    }
    if (track) {
      const next = await command({
        type: "timeline.add",
        assetId,
        trackId: track.id,
        startTicks: Math.max(
          0,
          Math.round(
            magnetic((x - labelWidth + scroll) / zoom) * timeline.timebase,
          ),
        ),
      });
      const added = next?.timeline?.clips.at(-1);
      if (added && next?.timeline) {
        setSelected(added.id);
        seek(added.startTicks / next.timeline.timebase);
      }
    }
  }
  return (
    <div
      className="timeline-viewport"
      ref={viewport}
      onScroll={(e) => setScroll(e.currentTarget.scrollLeft)}
      onDragOver={(e) => {
        e.preventDefault();
        const { x, y } = coordinates(e);
        const id =
          e.dataTransfer.getData("application/x-workstation-asset") ||
          document.querySelector<HTMLElement>("[data-dragging-asset]")?.dataset
            .draggingAsset;
        if (id)
          setDropPreview({
            assetId: id,
            start: magnetic((x - labelWidth + scroll) / zoom),
            y,
          });
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDropPreview(undefined);
      }}
      onDrop={drop}
      onContextMenu={(e) => context(e)}
    >
      {menu && (
        <TimelineContextMenu
          key={`${menu.x}-${menu.y}`}
          x={menu.x}
          y={menu.y}
          items={menuItems()}
          onClose={() => setMenu(undefined)}
        />
      )}
      <div
        style={{ width: Math.max(width, labelWidth + length * zoom), height }}
      >
        <div className="track-heads">
          {subtitleLanes.map((lane, i) => (
            <div
              className="track-head"
              key={lane.nodeId}
              style={{ top: 76 + i * 56, height: 56 }}
            >
              <button onClick={() => openPage(lane.nodeId)}>
                S{i + 1} · {lane.name} ↗
              </button>
              <span>{lane.cues.length} 条字幕 · 返回字幕页编辑</span>
            </div>
          ))}
          <div className="track-timecode">
            {new Date(Math.max(0, seconds) * 1000).toISOString().slice(11, 19)}:
            {String(
              Math.floor(
                ((seconds % 1) * timeline.frameRate.numerator) /
                  timeline.frameRate.denominator,
              ),
            ).padStart(2, "0")}
          </div>
          {timeline.tracks.map((track, i) => (
            <div
              className="track-head"
              key={track.id}
              onContextMenu={(e) => {
                e.stopPropagation();
                context(e, track.id, true);
              }}
              style={{
                top: rulerHeight + i * rowHeight,
                height: rowHeight,
                borderLeft: track.color
                  ? `3px solid ${track.color}`
                  : undefined,
              }}
            >
              <div className="track-switches">
                <span className="track-number">{track.name}</span>
                <button
                  title={track.locked ? "解锁轨道" : "锁定轨道"}
                  aria-pressed={Boolean(track.locked)}
                  onClick={() =>
                    command({
                      type: "timeline.trackUpdate",
                      trackId: track.id,
                      locked: !track.locked,
                    })
                  }
                >
                  {track.locked ? (
                    <LockKeyhole size={14} />
                  ) : (
                    <UnlockKeyhole size={14} />
                  )}
                </button>
                {track.kind === "video" ? (
                  <button
                    title="启用/关闭视频轨道"
                    aria-pressed={!track.disabled}
                    onClick={() =>
                      command({
                        type: "timeline.trackUpdate",
                        trackId: track.id,
                        disabled: !track.disabled,
                      })
                    }
                  >
                    {track.disabled ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                ) : (
                  <>
                    <button
                      title="独听"
                      aria-pressed={Boolean(track.solo)}
                      onClick={() =>
                        command({
                          type: "timeline.trackUpdate",
                          trackId: track.id,
                          solo: !track.solo,
                        })
                      }
                    >
                      S
                    </button>
                    <button
                      title="静音"
                      aria-pressed={Boolean(track.muted)}
                      onClick={() =>
                        command({
                          type: "timeline.trackUpdate",
                          trackId: track.id,
                          muted: !track.muted,
                        })
                      }
                    >
                      M
                    </button>
                  </>
                )}
              </div>
              <span>
                {track.kind === "video" ? "视频" : "音频"} ·{" "}
                {timeline.clips.filter((c) => c.trackId === track.id).length}{" "}
                个片段
              </span>
            </div>
          ))}
        </div>
        <canvas
          data-testid="timeline-canvas"
          ref={canvas}
          style={{ position: "sticky", left: 0, touchAction: "none" }}
          onPointerDown={down}
          onPointerMove={(e) => {
            if (scrubbing.current)
              seek(magnetic((coordinates(e).x - labelWidth + scroll) / zoom));
            else if (drag && !committing.current) {
              const { x, y } = coordinates(e);
              const position = magnetic(
                drag.clip.startTicks / timeline.timebase +
                  (x - drag.startX) / zoom,
                drag.clip,
              );
              setDrag({
                ...drag,
                currentX:
                  drag.startX +
                  (position - drag.clip.startTicks / timeline.timebase) * zoom,
                currentY: y,
              });
            }
          }}
          onPointerUp={up}
          onPointerCancel={() => {
            scrubbing.current = false;
            if (!committing.current) setDrag(null);
          }}
          aria-label="时间线片段画布"
          tabIndex={0}
        />
      </div>
      {!timeline.clips.length && (
        <div className="timeline-empty-hint">
          将素材拖入轨道，开始组装时间线
        </div>
      )}
    </div>
  );
}
