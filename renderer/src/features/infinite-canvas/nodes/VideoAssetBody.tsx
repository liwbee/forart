import { Maximize2, Minimize2, Play, Scissors, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getActiveForartConfig } from "../../../data-source/runtime";
import { resolveLibraryImageUrl } from "../../../lib/libraryImageActions";
import { cn } from "../../../lib/utils";
import type { CanvasStoredAsset } from "../canvasActions";

type CaptureMode = "first" | "last" | "current";
const CHROMIUM_MEDIA_CONTROLS_HIDE_DELAY_MS = 2500;

function VideoSlider({ value, max, className, onChange, ariaLabel }: { value: number; max: number; className: string; onChange: (value: number) => void; ariaLabel: string }) {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={cn("rf-native-video-slider", className)} style={{ "--slider-fill": `${percent}%` } as CSSProperties}>
      <div className="rf-native-video-slider-track" aria-hidden="true">
        <span className="rf-native-video-slider-fill" />
        <span className="rf-native-video-slider-thumb" />
      </div>
      <input
        className="rf-native-video-slider-input"
        type="range"
        min={0}
        max={max}
        step={0.01}
        value={Math.min(value, max || value)}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        aria-label={ariaLabel}
      />
    </div>
  );
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "00:00";
  const seconds = Math.floor(value);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function VideoAssetBody({ sourceUrl, thumbUrl, label, className, onCaptureComplete }: { sourceUrl: string; thumbUrl?: string; label: string; className?: string; onCaptureComplete?: (asset: CanvasStoredAsset, mode: CaptureMode) => void }) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const captureRef = useRef<HTMLDivElement | null>(null);
  const hideControlsTimerRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const captureOpenRef = useRef(false);
  const controlsHoveredRef = useRef(false);
  const [activated, setActivated] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const resolvedSource = resolveLibraryImageUrl(sourceUrl);
  const resolvedThumb = thumbUrl ? resolveLibraryImageUrl(thumbUrl) : "";

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    captureOpenRef.current = captureOpen;
  }, [captureOpen]);

  useEffect(() => {
    if (!activated) return;
    void videoRef.current?.play().catch(() => undefined);
  }, [activated]);

  const clearHideControlsTimer = useCallback(() => {
    if (hideControlsTimerRef.current !== null) {
      window.clearTimeout(hideControlsTimerRef.current);
      hideControlsTimerRef.current = null;
    }
  }, []);

  const scheduleHideControls = useCallback(() => {
    clearHideControlsTimer();
    if (!playingRef.current || captureOpenRef.current) return;
    hideControlsTimerRef.current = window.setTimeout(() => {
      hideControlsTimerRef.current = null;
      if (playingRef.current && !captureOpenRef.current && !controlsHoveredRef.current) setControlsVisible(false);
    }, CHROMIUM_MEDIA_CONTROLS_HIDE_DELAY_MS);
  }, [clearHideControlsTimer]);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    scheduleHideControls();
  }, [scheduleHideControls]);

  const hideControlsOnPointerLeave = useCallback(() => {
    clearHideControlsTimer();
    if (playingRef.current && !captureOpenRef.current) setControlsVisible(false);
  }, [clearHideControlsTimer]);

  useEffect(() => {
    if (playing && !captureOpen) scheduleHideControls();
    else {
      clearHideControlsTimer();
      setControlsVisible(true);
    }
    return clearHideControlsTimer;
  }, [captureOpen, clearHideControlsTimer, playing, scheduleHideControls]);

  useEffect(() => {
    if (!captureOpen) return;
    const onDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !captureRef.current?.contains(target)) setCaptureOpen(false);
    };
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCaptureOpen(false);
    };
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    document.addEventListener("keydown", onDocumentKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onDocumentPointerDown, true);
      document.removeEventListener("keydown", onDocumentKeyDown, true);
    };
  }, [captureOpen]);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const togglePlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const seek = useCallback((value: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(value, video.duration || value));
    setCurrentTime(video.currentTime);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void shell.requestFullscreen?.().catch(() => undefined);
    }
  }, []);

  const captureFrame = useCallback(async (mode: CaptureMode) => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      toast.error(t("infiniteCanvas:videoNotReady"));
      return;
    }
    setCaptureOpen(false);
    const wasPlaying = !video.paused;
    const beforeTime = video.currentTime;
    const targetTime = mode === "first" ? 0 : mode === "last" ? Math.max(0, (video.duration || duration) - 0.05) : beforeTime;
    const defaultName = `${label || "video"}-${mode}-frame.png`;
    try {
      if (mode !== "current") {
        video.pause();
        await new Promise<void>((resolve) => {
          if (Math.abs(video.currentTime - targetTime) < 0.001) {
            resolve();
            return;
          }
          const onSeeked = () => resolve();
          video.addEventListener("seeked", onSeeked, { once: true });
          video.currentTime = targetTime;
        });
      }
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error(t("infiniteCanvas:videoCanvasUnavailable"));
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      let dataUrl = "";
      let storedAsset: CanvasStoredAsset | null = null;
      try {
        dataUrl = canvas.toDataURL("image/png");
      } catch (error) {
        const isTaintedCanvas = error instanceof DOMException
          ? error.name === "SecurityError"
          : /tainted canvas|tainted canvases|securityerror/i.test(error instanceof Error ? error.message : String(error));
        if (!isTaintedCanvas || !window.easyTool?.captureVideoFrame) throw error;
        storedAsset = await window.easyTool.captureVideoFrame({
          sourceUrl: resolvedSource,
          timeSeconds: targetTime,
          mode,
          defaultName,
          kind: "output",
        });
      }
      if (dataUrl) {
        if (window.easyTool?.saveCanvasAsset) {
          storedAsset = await window.easyTool.saveCanvasAsset({ dataUrl, defaultName, kind: "output", type: "image/png" });
        } else {
          if (window.easyTool?.saveResult) {
            await window.easyTool.saveResult({ dataUrl, defaultName, directory: getActiveForartConfig()?.fileDownloadPath, convertToPng: false });
          } else {
            const link = document.createElement("a");
            link.href = dataUrl;
            link.download = defaultName;
            link.click();
          }
        }
      }
      if (storedAsset) onCaptureComplete?.(storedAsset, mode);
      toast.success(t("infiniteCanvas:videoFrameSaved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("infiniteCanvas:videoFrameCaptureFailed"));
    } finally {
      if (mode !== "current") {
        video.currentTime = beforeTime;
        if (wasPlaying) void video.play().catch(() => undefined);
      }
    }
  }, [duration, label, onCaptureComplete, resolvedSource, t]);

  if (!activated) {
    return (
      <button
        type="button"
        className={cn("rf-native-video-poster", className, !resolvedThumb && "is-empty")}
        onClick={(event) => {
          event.stopPropagation();
          setActivated(true);
        }}
        aria-label={label}
      >
        {resolvedThumb ? <img src={resolvedThumb} alt={label} draggable={false} /> : null}
        <span className="rf-native-video-play"><Play fill="currentColor" aria-hidden="true" /></span>
      </button>
    );
  }

  return (
    <div ref={shellRef} className={cn("rf-native-video-shell nodrag nopan nowheel", className, fullscreen && "is-fullscreen", !controlsVisible && "is-controls-hidden")} onPointerMove={revealControls} onPointerEnter={revealControls} onPointerLeave={hideControlsOnPointerLeave} onFocusCapture={revealControls}>
      <video
        ref={videoRef}
        className="rf-native-video"
        crossOrigin={/^forart-asset:/i.test(resolvedSource) ? "anonymous" : undefined}
        src={resolvedSource}
        poster={resolvedThumb || undefined}
        playsInline
        preload="metadata"
        aria-label={label}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onClick={togglePlayback}
      />
      <div
        className={cn("rf-native-video-controls", !controlsVisible && "is-hidden")}
        onPointerEnter={() => {
          controlsHoveredRef.current = true;
          revealControls();
        }}
        onPointerLeave={() => {
          controlsHoveredRef.current = false;
          scheduleHideControls();
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <VideoSlider className="rf-native-video-progress" value={currentTime} max={duration} onChange={seek} ariaLabel={t("infiniteCanvas:videoPlaybackProgress")} />
        <div className="rf-native-video-controls-row">
          <button type="button" className="rf-native-video-control" onClick={togglePlayback} aria-label={t(playing ? "infiniteCanvas:videoPause" : "infiniteCanvas:videoPlay")}>
            {playing ? <span className="rf-native-video-pause-glyph" aria-hidden="true"><i /><i /></span> : <Play fill="currentColor" aria-hidden="true" />}
          </button>
          <div className="rf-native-video-volume-group">
            <button type="button" className="rf-native-video-control" onClick={() => setVolume((value) => value > 0 ? 0 : 1)} aria-label={t(volume > 0 ? "infiniteCanvas:videoMute" : "infiniteCanvas:videoUnmute")}>
              {volume > 0 ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
            </button>
            <VideoSlider className="rf-native-video-volume" value={volume} max={1} onChange={setVolume} ariaLabel={t("infiniteCanvas:videoVolume")} />
          </div>
          <span className="rf-native-video-time rf-native-video-time-total">{formatTime(currentTime)} / {formatTime(duration)}</span>
          <div ref={captureRef} className="rf-native-video-capture">
            <button type="button" className={cn("rf-native-video-control", captureOpen && "is-active")} onClick={() => setCaptureOpen((open) => !open)} aria-label={t("infiniteCanvas:videoCaptureFrame")} aria-expanded={captureOpen}>
              <Scissors aria-hidden="true" />
            </button>
            {captureOpen ? <div className="rf-native-video-capture-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => void captureFrame("first")}>{t("infiniteCanvas:videoCaptureFirstFrame")}</button>
              <button type="button" role="menuitem" onClick={() => void captureFrame("last")}>{t("infiniteCanvas:videoCaptureLastFrame")}</button>
              <button type="button" role="menuitem" onClick={() => void captureFrame("current")}>{t("infiniteCanvas:videoCaptureCurrentFrame")}</button>
            </div> : null}
          </div>
          <button type="button" className="rf-native-video-control" onClick={toggleFullscreen} aria-label={t(fullscreen ? "infiniteCanvas:videoExitFullscreen" : "infiniteCanvas:videoFullscreen")}>
            {fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
}
