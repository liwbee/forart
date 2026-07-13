import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

interface ErrorCopyLineProps {
  text: string;
  className?: string;
  role?: "alert" | "status";
  ariaLive?: "assertive" | "polite";
}

export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function ErrorCopyLine({ text, className = "", role = "alert", ariaLive = "assertive" }: ErrorCopyLineProps) {
  const { t } = useTranslation();
  const label = t("common:actions.copyError");

  return (
    <div className={`error-copy-line${className ? ` ${className}` : ""}`} role={role} aria-live={ariaLive} title={text}>
      <Button
        className="error-copy-line__button nodrag nopan nowheel"
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          void copyText(text);
        }}
      >
        <Copy aria-hidden="true" />
      </Button>
      <span className="error-copy-line__text">{text}</span>
    </div>
  );
}
