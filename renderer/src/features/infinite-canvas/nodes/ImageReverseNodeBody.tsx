import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "../../../components/ui/skeleton";
import type { NativeCanvasNode } from "../nativeCanvas";

export function SmartReverseNodeBody({ nodeId: _nodeId, data, running = false }: { nodeId: string; data: NativeCanvasNode["data"]; running?: boolean }) {
  const { t } = useTranslation();
  const [textSelectionEnabled, setTextSelectionEnabled] = useState(false);
  const outputRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (running) setTextSelectionEnabled(false);
  }, [running]);

  const enableTextSelection = () => {
    setTextSelectionEnabled(true);
    window.requestAnimationFrame(() => outputRef.current?.focus());
  };
  const hasText = Boolean(String(data.text || ""));

  return (
    <div className="rf-native-image-reverse-body">
      <div
        ref={outputRef}
        className={[
          "rf-native-image-reverse-output nowheel",
          textSelectionEnabled ? "is-selectable nodrag nopan" : "",
          running || !hasText ? "is-placeholder" : "",
          running ? "is-running" : "",
        ].filter(Boolean).join(" ")}
        data-canvas-text-copy
        role="textbox"
        aria-readonly="true"
        aria-label={t("infiniteCanvas:smartReverseOutput")}
        tabIndex={textSelectionEnabled ? 0 : -1}
        onPointerDown={textSelectionEnabled ? (event) => event.stopPropagation() : undefined}
        onDoubleClick={(event) => {
          if (textSelectionEnabled || running || !hasText) return;
          event.preventDefault();
          event.stopPropagation();
          enableTextSelection();
        }}
        onBlur={() => setTextSelectionEnabled(false)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          outputRef.current?.blur();
        }}
      >
        {running ? (
          <div className="rf-native-image-reverse-skeleton" role="status" aria-label={t("infiniteCanvas:smartReverseRunning")}>
            <Skeleton className="h-3 w-[92%]" />
            <Skeleton className="h-3 w-[78%]" />
            <Skeleton className="h-3 w-[64%]" />
          </div>
        ) : hasText ? String(data.text) : (
          <div className="rf-native-image-reverse-skeleton rf-native-image-reverse-skeleton--static" aria-label={t("infiniteCanvas:smartReverseOutputPlaceholder")}>
            <Skeleton className="h-2.5 w-[72%] animate-none" />
            <Skeleton className="h-2.5 w-[58%] animate-none" />
            <Skeleton className="h-2.5 w-[42%] animate-none" />
          </div>
        )}
      </div>
    </div>
  );
}
