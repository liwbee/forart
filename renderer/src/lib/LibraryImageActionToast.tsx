import { useCallback, useEffect, useRef, useState } from "react";
import { Check, RefreshCw, X } from "lucide-react";
import { ErrorCopyLine } from "../components/ErrorCopyLine";

export type LibraryImageActionToastTone = "busy" | "ready" | "error";

export interface LibraryImageActionToastState {
  tone: LibraryImageActionToastTone;
  text: string;
}

export function useLibraryImageActionToast() {
  const [toast, setToast] = useState<LibraryImageActionToastState | null>(null);
  const timerRef = useRef<number | null>(null);

  const showToast = useCallback((tone: LibraryImageActionToastTone, text: string, autoHideMs = tone === "busy" ? 0 : 3600) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setToast({ tone, text });
    timerRef.current = autoHideMs > 0
      ? window.setTimeout(() => {
          setToast(null);
          timerRef.current = null;
        }, autoHideMs)
      : null;
  }, []);

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  return { toast, showToast };
}

export function LibraryImageActionToast({ toast }: { toast: LibraryImageActionToastState | null }) {
  if (!toast) return null;
  if (toast.tone === "error") {
    return <ErrorCopyLine className="library-image-action-toast library-image-action-toast--error" text={toast.text} />;
  }
  const Icon = toast.tone === "busy" ? RefreshCw : toast.tone === "ready" ? Check : X;
  return (
    <div
      className={`library-image-action-toast library-image-action-toast--${toast.tone}`}
      role="status"
      aria-live="polite"
    >
      <Icon size={14} aria-hidden="true" />
      <span>{toast.text}</span>
    </div>
  );
}
