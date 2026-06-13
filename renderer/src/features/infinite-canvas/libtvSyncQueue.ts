export interface LibtvRemotePatchQueueOptions<TPatch> {
  onFlush: (nodeId: string, patch: TPatch) => Promise<void> | void;
  onPendingChange?: (pendingCount: number) => void;
  mergePatch?: (current: TPatch, next: TPatch) => TPatch;
  setTimeout?: (callback: () => void, delayMs: number) => unknown;
  clearTimeout?: (timer: unknown) => void;
}

interface PendingRemotePatch<TPatch> {
  patch: TPatch;
  sequence: number;
  timer: unknown | null;
  flushing?: boolean;
}

function defaultMergePatch<TPatch extends object>(current: TPatch, next: TPatch) {
  return { ...current, ...next };
}

export class LibtvRemotePatchQueue<TPatch extends object> {
  private pending: Record<string, PendingRemotePatch<TPatch>> = {};
  private sequence = 0;
  private readonly onFlush: (nodeId: string, patch: TPatch) => Promise<void> | void;
  private readonly onPendingChange?: (pendingCount: number) => void;
  private readonly mergePatch: (current: TPatch, next: TPatch) => TPatch;
  private readonly scheduleTimer: (callback: () => void, delayMs: number) => unknown;
  private readonly cancelTimer: (timer: unknown) => void;

  constructor(options: LibtvRemotePatchQueueOptions<TPatch>) {
    this.onFlush = options.onFlush;
    this.onPendingChange = options.onPendingChange;
    this.mergePatch = options.mergePatch || defaultMergePatch;
    this.scheduleTimer = options.setTimeout || ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.cancelTimer = options.clearTimeout || ((timer) => globalThis.clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>));
  }

  hasPending(nodeId?: string) {
    return nodeId ? Boolean(this.pending[nodeId]) : Object.keys(this.pending).length > 0;
  }

  getPendingNodeIds() {
    return Object.keys(this.pending);
  }

  clearNode(nodeId: string) {
    const pending = this.pending[nodeId];
    if (pending?.timer) this.cancelTimer(pending.timer);
    delete this.pending[nodeId];
    this.onPendingChange?.(this.getPendingNodeIds().length);
  }

  clearAll() {
    Object.keys(this.pending).forEach((nodeId) => this.clearNode(nodeId));
  }

  queue(nodeId: string, patch: TPatch, options: { debounceMs?: number | null; flush?: boolean } = {}) {
    const current = this.pending[nodeId];
    const sequence = this.sequence + 1;
    this.sequence = sequence;
    if (current?.timer) this.cancelTimer(current.timer);

    this.pending[nodeId] = {
      patch: current ? this.mergePatch(current.patch, patch) : patch,
      sequence,
      timer: null,
    };
    this.onPendingChange?.(this.getPendingNodeIds().length);

    if (options.flush) {
      this.flushNode(nodeId);
      return;
    }

    if (options.debounceMs === null) return;

    const debounceMs = options.debounceMs ?? 500;
    this.pending[nodeId].timer = this.scheduleTimer(() => {
      const pending = this.pending[nodeId];
      if (!pending || pending.sequence !== sequence) return;
      this.flushNode(nodeId);
    }, debounceMs);
  }

  flushNode(nodeId: string) {
    const pending = this.pending[nodeId];
    if (!pending || pending.flushing) return;
    if (pending.timer) this.cancelTimer(pending.timer);
    this.pending[nodeId] = { ...pending, timer: null, flushing: true };
    this.onPendingChange?.(this.getPendingNodeIds().length);

    void Promise.resolve(this.onFlush(nodeId, pending.patch))
      .then(() => {
        const current = this.pending[nodeId];
        if (current?.sequence === pending.sequence && current.flushing) {
          delete this.pending[nodeId];
          this.onPendingChange?.(this.getPendingNodeIds().length);
        }
      })
      .catch(() => {
        this.pending[nodeId] = { ...pending, timer: null };
        this.onPendingChange?.(this.getPendingNodeIds().length);
      });
  }

  flushNodes(nodeIds: Iterable<string>) {
    Array.from(nodeIds).forEach((nodeId) => this.flushNode(nodeId));
  }

  flushAll() {
    Object.keys(this.pending).forEach((nodeId) => this.flushNode(nodeId));
  }
}
