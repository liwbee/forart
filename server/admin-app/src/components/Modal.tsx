import { X } from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";

type ModalProps = PropsWithChildren<{
  title: string;
  open: boolean;
  onClose: () => void;
  footer?: ReactNode;
  size?: "default" | "wide";
}>;

export function Modal({ title, open, onClose, footer, size = "default", children }: ModalProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section aria-labelledby="modal-title" aria-modal="true" className={`modal${size === "wide" ? " modal--wide" : ""}`} role="dialog">
        <header className="modal__header">
          <h2 id="modal-title">{title}</h2>
          <button aria-label="关闭" className="icon-button" onClick={onClose} title="关闭" type="button"><X size={16} /></button>
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </section>
    </div>
  );
}
