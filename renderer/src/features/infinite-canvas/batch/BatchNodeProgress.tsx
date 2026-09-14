import { cn } from "../../../lib/utils";

export function BatchNodeProgress({ completed, total, tone, className, label }: {
  completed: number;
  total: number;
  tone: "idle" | "queued" | "running" | "completed" | "error" | "ready";
  className?: string;
  label?: string;
}) {
  return <span className={cn("rf-generation-status", "rf-generation-header-status", className)} data-tone={tone}>{label || `${completed}/${total}`}</span>;
}
