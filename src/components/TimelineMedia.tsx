import { useCallback, useEffect, useRef, useState } from "react";
import type { Asset, Clip, Timeline } from "../../packages/sdk/src";
import { useAssetUrl } from "./MediaPage";

export interface TimelineClock {
  clipId: string;
  element: HTMLMediaElement;
}
export function TimelineMedia({
  asset,
  clip,
  timeline,
  seconds,
  playing,
  seekVersion,
  projectId,
  registerClock,
  onFailure,
  audioOnly = false,
  muted = false,
}: {
  asset: Asset;
  clip: Clip;
  timeline: Timeline;
  seconds: number;
  playing: boolean;
  seekVersion: number;
  projectId: string;
  registerClock?: (clipId: string, element: HTMLMediaElement | null) => void;
  onFailure: (message: string) => void;
  audioOnly?: boolean;
  muted?: boolean;
}) {
  const url = useAssetUrl(projectId, asset);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const latest = useRef({ seconds, playing });
  latest.current = { seconds, playing };
  const playPending = useRef<Promise<void> | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const attach = useCallback(
    (element: HTMLVideoElement | HTMLAudioElement | null) => {
      mediaRef.current = element;
      registerClock?.(clip.id, element);
    },
    [clip.id, registerClock],
  );
  function fail(message: string) {
    setError(message);
    onFailure(message);
  }
  function playOrPause() {
    const media = mediaRef.current;
    if (!media) return;
    if (!latest.current.playing) {
      media.pause();
      return;
    }
    if (!media.paused || playPending.current) return;
    const request = media.play();
    playPending.current = request;
    void request
      .catch((reason: unknown) => {
        if (media !== mediaRef.current || !latest.current.playing) return;
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
        fail(
          `无法播放时间线素材：${reason instanceof Error ? reason.message : String(reason)}`,
        );
      })
      .finally(() => {
        if (playPending.current === request) playPending.current = null;
      });
  }
  function seekToPlayhead() {
    const media = mediaRef.current;
    if (!media || media.readyState < 1) return;
    const target = Math.max(
      0,
      latest.current.seconds -
        clip.startTicks / timeline.timebase +
        clip.inTicks / timeline.timebase,
    );
    const bounded = Number.isFinite(media.duration)
      ? Math.min(target, Math.max(0, media.duration - 0.0001))
      : target;
    // Seeking to zero again during MKV initialization can abort the first decoded frame.
    // Transport ticks never write currentTime; only an explicit seek or source load does.
    if (Math.abs(media.currentTime - bounded) > 0.025)
      media.currentTime = bounded;
  }
  useEffect(() => {
    setError("");
    playPending.current = null;
  }, [url, retry]);
  useEffect(() => {
    seekToPlayhead();
  }, [url, retry, seekVersion, clip.inTicks, clip.startTicks]);
  useEffect(() => {
    playOrPause();
  }, [url, retry, playing, clip.id]);
  const loaded = () => {
    seekToPlayhead();
    playOrPause();
  };
  const mediaError = () => {
    const code = mediaRef.current?.error?.code;
    fail(`时间线素材加载失败${code ? `（${code}）` : ""}：${asset.name}`);
  };
  if (error)
    return (
      <div className="preview-placeholder" role="alert">
        <span>{error}</span>
        <button
          className="button"
          onClick={() => {
            setError("");
            setRetry((n) => n + 1);
          }}
        >
          重新加载
        </button>
      </div>
    );
  if (!url)
    return (
      <div className="preview-placeholder">
        <span>正在加载时间线素材…</span>
      </div>
    );
  if (asset.mediaType === "image") return <img src={url} alt={asset.name} />;
  if (asset.mediaType === "audio" || audioOnly)
    return (
      <audio
        key={`${url}-${retry}`}
        ref={attach}
        src={url}
        preload="auto"
        onLoadedMetadata={loaded}
        onCanPlay={playOrPause}
        onSeeked={playOrPause}
        onError={mediaError}
      />
    );
  return (
    <video
      data-testid="timeline-video"
      key={`${url}-${retry}`}
      ref={attach}
      src={url}
      preload="auto"
      playsInline
      muted={muted}
      onLoadedMetadata={loaded}
      onCanPlay={playOrPause}
      onSeeked={playOrPause}
      onError={mediaError}
    />
  );
}
