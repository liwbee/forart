export type CanvasAgentTask = "smart-reverse" | "optimize-image-generator-prompt";

export interface CanvasAgentRunState {
  runId: string;
  task: CanvasAgentTask;
  operation?: string;
  canvasId: string;
  nodeId: string;
  sourcePrompt?: string;
  startedAt?: number;
  stage: string;
  status: "running" | "completed" | "failed" | "canceled";
  result?: unknown;
  error?: string;
}

export interface CanvasAgentApi {
  runs: Record<string, CanvasAgentRunState>;
  run: (input: { task: CanvasAgentTask; nodeId: string; context: unknown; modelRoute?: { providerId: string; model: string }; reasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"; onRunId?: (runId: string) => void }) => Promise<{ runId: string; result: unknown }>;
  cancel: (runId: string) => Promise<void>;
  getRun: (runId: string) => CanvasAgentRunState | undefined;
}
