import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "../../../lib/utils";
import type { GenerationStatusPresentation } from "./generationStatusPresentation";

export function GenerationStatusDisplay({
  presentation,
  mode,
  className,
}: {
  presentation: GenerationStatusPresentation;
  mode: "overlay" | "inline";
  className?: string;
}) {
  const { t } = useTranslation();
  if (mode === "inline") {
    return (
      <span className={cn("rf-generation-status", className)} data-tone={presentation.tone} title={presentation.message}>
        <span>{presentation.message}</span>
        {presentation.showElapsed ? <time>{presentation.elapsedText}</time> : null}
      </span>
    );
  }
  if (!presentation.showTransient) return null;
  return (
    <>
      {presentation.showElapsed ? (
        <time
          className="rf-generation-status-timer"
          aria-label={t("infiniteCanvas:generationElapsed", { time: presentation.elapsedText })}
        >
          {presentation.elapsedText}
        </time>
      ) : null}
      <div
        className={cn("rf-generation-status-display", presentation.tone === "error" && "is-error", className)}
        role={presentation.tone === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {presentation.tone === "error" ? <CircleAlert aria-hidden="true" /> : null}
        <span>{presentation.message}</span>
      </div>
    </>
  );
}
