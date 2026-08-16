const GENERATION_EXECUTION_TIMEOUT_MS = 30 * 60 * 1000;

function timeoutDurationLabel(timeoutMs) {
  if (timeoutMs >= 60 * 1000 && timeoutMs % (60 * 1000) === 0) return `${timeoutMs / (60 * 1000)} minutes`;
  if (timeoutMs >= 1000 && timeoutMs % 1000 === 0) return `${timeoutMs / 1000} seconds`;
  return `${timeoutMs} ms`;
}

function createGenerationExecutionTimeout({ timeoutMs = GENERATION_EXECUTION_TIMEOUT_MS, startedAt = 0 } = {}) {
  const normalizedTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : GENERATION_EXECUTION_TIMEOUT_MS;
  const normalizedStartedAt = Number(startedAt || 0);
  const elapsedMs = normalizedStartedAt > 0 ? Math.max(0, Date.now() - normalizedStartedAt) : 0;
  const remainingMs = Math.max(0, normalizedTimeoutMs - elapsedMs);
  const controller = new AbortController();
  let timedOut = false;
  const errorMessage = `Generation task timed out after ${timeoutDurationLabel(normalizedTimeoutMs)}.`;
  const expire = () => {
    timedOut = true;
    controller.abort(new Error(errorMessage));
  };
  const timer = remainingMs > 0 ? setTimeout(expire, remainingMs) : null;
  if (timer) timer.unref?.();
  else expire();

  return {
    controller,
    errorMessage,
    didTimeout() {
      return timedOut;
    },
    dispose() {
      if (timer) clearTimeout(timer);
    },
  };
}

module.exports = {
  GENERATION_EXECUTION_TIMEOUT_MS,
  createGenerationExecutionTimeout,
};
