import type { Viewport } from "@xyflow/react";

export type ViewportMotionState = "idle" | "dragging" | "sliding";

interface ViewportMomentumScheduler {
  now: () => number;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (frameId: number) => void;
}

interface ViewportMomentumOptions {
  initialViewport: Viewport;
  applyViewport: (viewport: Viewport) => void;
  settleViewport: (viewport: Viewport) => void;
  scheduler?: ViewportMomentumScheduler;
}

interface Velocity {
  x: number;
  y: number;
}

interface VelocitySample extends Viewport {
  time: number;
}

interface InternalViewport extends Viewport {
  expiresAt: number;
}

const REFERENCE_FRAME_MS = 16;
const POINTER_VELOCITY_SMOOTHING = 0.5;
const CAMERA_SLIDE_FRICTION = 0.09;
const CAMERA_SLIDE_START_SPEED = 0.1;
const CAMERA_SLIDE_STOP_SPEED = 0.01;
const CAMERA_SLIDE_MAX_SPEED = 2;
const INTERNAL_VIEWPORT_TTL_MS = 2_000;
const MAX_INTERNAL_VIEWPORTS = 128;

function copyViewport(viewport: Viewport): Viewport {
  return { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
}

function sameViewport(a: Viewport, b: Viewport) {
  return Math.abs(a.x - b.x) < 0.001
    && Math.abs(a.y - b.y) < 0.001
    && Math.abs(a.zoom - b.zoom) < 0.0001;
}

function defaultScheduler(): ViewportMomentumScheduler {
  return {
    now: () => performance.now(),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (frameId) => window.cancelAnimationFrame(frameId),
  };
}

export class ViewportMomentumController {
  private state: ViewportMotionState = "idle";
  private viewport: Viewport;
  private latestDragViewport: Viewport;
  private dragStartZoom = 1;
  private velocity: Velocity = { x: 0, y: 0 };
  private velocitySample: VelocitySample | null = null;
  private frameId: number | null = null;
  private slideLastTime = 0;
  private internalViewports: InternalViewport[] = [];
  private readonly scheduler: ViewportMomentumScheduler;

  constructor(private readonly options: ViewportMomentumOptions) {
    this.viewport = copyViewport(options.initialViewport);
    this.latestDragViewport = copyViewport(options.initialViewport);
    this.scheduler = options.scheduler || defaultScheduler();
  }

  getState() {
    return this.state;
  }

  getViewport() {
    return copyViewport(this.viewport);
  }

  syncViewport(viewport: Viewport) {
    this.viewport = copyViewport(viewport);
    if (this.state === "dragging") this.latestDragViewport = copyViewport(viewport);
  }

  beginUserMove(viewport: Viewport) {
    this.stop();
    const now = this.scheduler.now();
    this.state = "dragging";
    this.viewport = copyViewport(viewport);
    this.latestDragViewport = copyViewport(viewport);
    this.dragStartZoom = viewport.zoom;
    this.velocity = { x: 0, y: 0 };
    this.velocitySample = { ...copyViewport(viewport), time: now };
    this.requestNextFrame();
  }

  updateUserMove(viewport: Viewport) {
    if (this.state !== "dragging") return;
    this.viewport = copyViewport(viewport);
    this.latestDragViewport = copyViewport(viewport);
  }

  endUserMove(viewport: Viewport) {
    if (this.state !== "dragging") {
      this.syncViewport(viewport);
      return;
    }
    this.latestDragViewport = copyViewport(viewport);
    this.viewport = copyViewport(viewport);
    this.samplePointerVelocity(this.scheduler.now());
    this.cancelScheduledFrame();
    this.options.settleViewport(copyViewport(viewport));

    const zoomChanged = Math.abs(this.dragStartZoom - viewport.zoom) > 0.001;
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    if (zoomChanged || speed <= CAMERA_SLIDE_START_SPEED) {
      this.resetToIdle();
      return;
    }

    const speedScale = Math.min(1, CAMERA_SLIDE_MAX_SPEED / speed);
    this.velocity = {
      x: this.velocity.x * speedScale,
      y: this.velocity.y * speedScale,
    };
    this.velocitySample = null;
    this.state = "sliding";
    this.slideLastTime = this.scheduler.now();
    this.requestNextFrame();
  }

  stop(settle = true) {
    const wasSliding = this.state === "sliding";
    this.cancelScheduledFrame();
    this.resetToIdle();
    if (settle && wasSliding) this.options.settleViewport(copyViewport(this.viewport));
  }

  dispose() {
    this.stop(false);
    this.internalViewports = [];
  }

  isInternalViewport(viewport: Viewport) {
    const now = this.scheduler.now();
    this.internalViewports = this.internalViewports.filter((item) => item.expiresAt > now);
    return this.internalViewports.some((item) => sameViewport(item, viewport));
  }

  private requestNextFrame() {
    if (this.frameId !== null) return;
    this.frameId = this.scheduler.requestFrame((time) => {
      this.frameId = null;
      if (this.state === "dragging") {
        this.samplePointerVelocity(time);
        this.requestNextFrame();
      } else if (this.state === "sliding") {
        this.advanceSlide(time);
      }
    });
  }

  private cancelScheduledFrame() {
    if (this.frameId === null) return;
    this.scheduler.cancelFrame(this.frameId);
    this.frameId = null;
  }

  private samplePointerVelocity(time: number) {
    const previous = this.velocitySample;
    const current = this.latestDragViewport;
    if (!previous || time <= previous.time) return;
    const elapsed = time - previous.time;
    const zoomChanged = Math.abs(previous.zoom - current.zoom) > 0.001;
    const targetX = zoomChanged ? 0 : (current.x - previous.x) / elapsed;
    const targetY = zoomChanged ? 0 : (current.y - previous.y) / elapsed;
    const smoothing = 1 - Math.pow(1 - POINTER_VELOCITY_SMOOTHING, elapsed / REFERENCE_FRAME_MS);
    this.velocity = {
      x: this.velocity.x + (targetX - this.velocity.x) * smoothing,
      y: this.velocity.y + (targetY - this.velocity.y) * smoothing,
    };
    if (Math.abs(this.velocity.x) < 0.01) this.velocity.x = 0;
    if (Math.abs(this.velocity.y) < 0.01) this.velocity.y = 0;
    this.velocitySample = { ...copyViewport(current), time };
  }

  private advanceSlide(time: number) {
    if (this.state !== "sliding") return;
    const elapsed = Math.min(32, Math.max(1, time - this.slideLastTime));
    this.slideLastTime = time;
    const previousViewport = this.viewport;
    const nextViewport = {
      x: previousViewport.x + this.velocity.x * elapsed,
      y: previousViewport.y + this.velocity.y * elapsed,
      zoom: previousViewport.zoom,
    };
    // React Flow emits a programmatic move start with the previous transform,
    // followed by move/end events with the next transform.
    this.rememberInternalViewport(previousViewport);
    this.viewport = nextViewport;
    this.rememberInternalViewport(nextViewport);
    this.options.applyViewport(copyViewport(nextViewport));

    const friction = Math.pow(1 - CAMERA_SLIDE_FRICTION, elapsed / REFERENCE_FRAME_MS);
    this.velocity = {
      x: this.velocity.x * friction,
      y: this.velocity.y * friction,
    };
    if (Math.hypot(this.velocity.x, this.velocity.y) < CAMERA_SLIDE_STOP_SPEED) {
      this.resetToIdle();
      this.options.settleViewport(copyViewport(this.viewport));
      return;
    }
    this.requestNextFrame();
  }

  private rememberInternalViewport(viewport: Viewport) {
    const expiresAt = this.scheduler.now() + INTERNAL_VIEWPORT_TTL_MS;
    this.internalViewports.push({ ...copyViewport(viewport), expiresAt });
    if (this.internalViewports.length > MAX_INTERNAL_VIEWPORTS) {
      this.internalViewports.splice(0, this.internalViewports.length - MAX_INTERNAL_VIEWPORTS);
    }
  }

  private resetToIdle() {
    this.state = "idle";
    this.velocity = { x: 0, y: 0 };
    this.velocitySample = null;
  }
}
