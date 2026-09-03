import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { CanvasAgentApi, CanvasAgentRunState, CanvasAgentTask } from "./canvasAgentTypes";

const CanvasAgentContext = createContext<CanvasAgentApi | null>(null);

function createRunId() {
  return `agent_${Date.now().toString(36)}_${crypto.randomUUID()}`;
}

function isCanceledStatus(status: CanvasAgentRunState["status"] | undefined) {
  return status === "canceled";
}

export function CanvasAgentProvider({ children, canvasId = "" }: PropsWithChildren<{ canvasId?: string }>) {
  const { t, i18n } = useTranslation();
  const [allRuns, setAllRuns] = useState<Record<string, CanvasAgentRunState>>({});
  const allRunsRef = useRef(allRuns);
  const runStatusRef = useRef<Record<string, CanvasAgentRunState["status"]>>({});
  const notifiedRunIdsRef = useRef(new Set<string>());
  allRunsRef.current = allRuns;

  const taskLabel = useCallback((task: CanvasAgentTask) => {
    if (task === "smart-reverse") return t("infiniteCanvas:smartReverse");
    return t("infiniteCanvas:promptOptimization");
  }, [t]);

  const notifyTerminal = useCallback((run: CanvasAgentRunState) => {
    if ((run.status !== "completed" && run.status !== "failed") || notifiedRunIdsRef.current.has(run.runId)) return;
    notifiedRunIdsRef.current.add(run.runId);
    const label = taskLabel(run.task);
    if (run.status === "completed") {
      toast.success(t("infiniteCanvas:agentTaskCompleted", { task: label }));
      return;
    }
    toast.error(t("infiniteCanvas:agentTaskFailed", { task: label }), {
      description: run.error || undefined,
    });
  }, [t, taskLabel]);

  useEffect(() => {
    let active = true;
    const disconnect = window.forartCanvasAgent?.onProgress((progress) => {
      runStatusRef.current[progress.runId] = progress.status;
      const nextRun = {
        ...allRunsRef.current[progress.runId],
        ...progress,
        runId: progress.runId,
        task: progress.task,
        canvasId: progress.canvasId || allRunsRef.current[progress.runId]?.canvasId || "",
        nodeId: progress.nodeId,
      };
      allRunsRef.current = { ...allRunsRef.current, [progress.runId]: nextRun };
      setAllRuns(allRunsRef.current);
      notifyTerminal(nextRun);
    });
    const activeRunsRequest = window.forartCanvasAgent?.listActive?.();
    if (activeRunsRequest) void activeRunsRequest.then((runtimeRuns) => {
      if (!active) return;
      const next = { ...allRunsRef.current };
      for (const run of runtimeRuns) {
        const existing = next[run.runId];
        if (existing && existing.status !== "running") continue;
        next[run.runId] = run;
        runStatusRef.current[run.runId] = run.status;
      }
      allRunsRef.current = next;
      setAllRuns(next);
    }).catch(() => undefined);
    return () => {
      active = false;
      disconnect?.();
    };
  }, [notifyTerminal]);

  const run = useCallback(async ({ task, nodeId, context, modelRoute, reasoning, onRunId }: { task: CanvasAgentTask; nodeId: string; context: unknown; modelRoute?: { providerId: string; model: string }; reasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"; onRunId?: (runId: string) => void }) => {
    const runId = createRunId();
    const startedAt = Date.now();
    onRunId?.(runId);
    runStatusRef.current[runId] = "running";
    const queuedRun: CanvasAgentRunState = { runId, task, canvasId, nodeId, stage: "queued", status: "running", startedAt };
    allRunsRef.current = { ...allRunsRef.current, [runId]: queuedRun };
    setAllRuns(allRunsRef.current);
    try {
      if (!window.forartCanvasAgent?.run) throw new Error("Canvas Agent requires the desktop app.");
      // 输出语言跟随当前界面语言，主进程未收到时回退旧设置。
      const language = i18n.language === "en-US" ? "en-US" : "zh-CN";
      const result = await window.forartCanvasAgent.run({ runId, task, canvasId, nodeId, context, language, ...(modelRoute ? { modelRoute } : {}), ...(reasoning ? { reasoning } : {}) });
      const completedRun: CanvasAgentRunState = { ...allRunsRef.current[runId], runId, task, canvasId, nodeId, startedAt, stage: "completed", status: "completed", result };
      runStatusRef.current[runId] = "completed";
      allRunsRef.current = { ...allRunsRef.current, [runId]: completedRun };
      setAllRuns(allRunsRef.current);
      notifyTerminal(completedRun);
      return { runId, result };
    } catch (error) {
      if (isCanceledStatus(runStatusRef.current[runId])) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const failedRun: CanvasAgentRunState = { ...allRunsRef.current[runId], runId, task, canvasId, nodeId, startedAt, stage: allRunsRef.current[runId]?.stage || "queued", status: "failed", error: message };
      runStatusRef.current[runId] = "failed";
      allRunsRef.current = { ...allRunsRef.current, [runId]: failedRun };
      setAllRuns(allRunsRef.current);
      notifyTerminal(failedRun);
      throw error;
    }
  }, [canvasId, notifyTerminal]);

  const cancel = useCallback(async (runId: string) => {
    runStatusRef.current[runId] = "canceled";
    const currentRun = allRunsRef.current[runId];
    if (currentRun) {
      allRunsRef.current = { ...allRunsRef.current, [runId]: { ...currentRun, status: "canceled" } };
      setAllRuns(allRunsRef.current);
    }
    await window.forartCanvasAgent?.cancel(runId);
  }, []);

  const runs = useMemo(() => Object.fromEntries(
    Object.entries(allRuns).filter(([, runState]) => runState.canvasId === canvasId),
  ), [allRuns, canvasId]);
  const getRun = useCallback((runId: string) => {
    const runState = allRunsRef.current[runId];
    return runState?.canvasId === canvasId ? runState : undefined;
  }, [canvasId]);
  const value = useMemo<CanvasAgentApi>(() => ({ runs, run, cancel, getRun }), [cancel, getRun, run, runs]);
  return <CanvasAgentContext.Provider value={value}>{children}</CanvasAgentContext.Provider>;
}

export function useCanvasAgent() {
  const value = useContext(CanvasAgentContext);
  if (!value) throw new Error("useCanvasAgent must be used inside CanvasAgentProvider.");
  return value;
}
