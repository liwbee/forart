export interface CanvasAutosaveSchedulerOptions {
  save: () => Promise<boolean>;
  debounceMs?: number;
  maxWaitMs?: number;
  settleMs?: number;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface CanvasAutosaveScheduler {
  dispose: () => void;
  flush: () => Promise<boolean>;
  markDirty: () => void;
  reset: () => void;
  setInteracting: (active: boolean) => void;
}

export function createCanvasAutosaveScheduler({
  save,
  debounceMs = 2_000,
  maxWaitMs = 10_000,
  settleMs = 400,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (timer) => clearTimeout(timer),
}: CanvasAutosaveSchedulerOptions): CanvasAutosaveScheduler {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  let activeSave: Promise<boolean> | null = null;
  let dirty = false;
  let disposed = false;
  let interacting = false;
  let saveRequested = false;
  let settling = false;

  const clearDebounceTimer = () => {
    if (debounceTimer === null) return;
    clearTimer(debounceTimer);
    debounceTimer = null;
  };

  const clearMaxWaitTimer = () => {
    if (maxWaitTimer === null) return;
    clearTimer(maxWaitTimer);
    maxWaitTimer = null;
  };

  const clearTimers = () => {
    clearDebounceTimer();
    clearMaxWaitTimer();
  };

  let requestSave: (force?: boolean) => Promise<boolean>;

  const schedule = (delay = debounceMs) => {
    if (disposed || !dirty || interacting) return;
    clearDebounceTimer();
    debounceTimer = setTimer(() => {
      debounceTimer = null;
      settling = false;
      void requestSave();
    }, delay);
    if (maxWaitTimer !== null) return;
    maxWaitTimer = setTimer(() => {
      maxWaitTimer = null;
      settling = false;
      void requestSave();
    }, maxWaitMs);
  };

  requestSave = async (force = false) => {
    if (disposed) return true;
    clearTimers();
    if (interacting && !force) {
      saveRequested = true;
      return true;
    }
    if (activeSave) {
      saveRequested = true;
      const result = await activeSave;
      if (force && dirty) return requestSave(true);
      return result;
    }
    if (!dirty) return true;

    dirty = false;
    saveRequested = false;
    const operation = Promise.resolve(save()).catch(() => false);
    activeSave = operation;
    const result = await operation;
    if (activeSave === operation) activeSave = null;
    if (!result) dirty = true;

    if (saveRequested && dirty) {
      saveRequested = false;
      return requestSave(force);
    }
    if (dirty && !force) schedule();
    return result;
  };

  return {
    dispose() {
      disposed = true;
      clearTimers();
    },
    flush() {
      return requestSave(true);
    },
    markDirty() {
      if (disposed) return;
      dirty = true;
      schedule(settling ? settleMs : debounceMs);
    },
    reset() {
      dirty = false;
      interacting = false;
      saveRequested = false;
      settling = false;
      clearTimers();
    },
    setInteracting(active) {
      if (disposed || interacting === active) return;
      interacting = active;
      if (active) {
        settling = false;
        clearDebounceTimer();
        return;
      }
      settling = true;
      if (dirty) schedule(settleMs);
    },
  };
}
