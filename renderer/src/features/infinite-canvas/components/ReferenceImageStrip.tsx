import { ImagePlus, X } from "lucide-react";
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ReferenceImageHoverPreview } from "./ReferenceImageHoverPreview";

export interface ReferenceImageStripItem {
  id: string;
  connectionId: string;
  order: number;
  title: string;
  url: string;
}

export interface ComposerPromptInputItem {
  id: string;
  connectionId: string;
  title: string;
  text: string;
}

interface ReferenceImageStripProps {
  imageItems: ReferenceImageStripItem[];
  promptItems?: ComposerPromptInputItem[];
  targetId: string;
  draggedConnectionId: string;
  className?: string;
  uploadButton?: ReactNode;
  ariaLabel?: string;
  deleteLabel: string;
  onRemove: (connectionId: string) => void;
  onReorder: (targetId: string, connectionId: string, imageInsertIndex: number) => void;
  onDraggedConnectionIdChange: (connectionId: string) => void;
}

function getInsertIndex(container: HTMLDivElement, clientX: number) {
  const imageItems = Array.from(container.querySelectorAll<HTMLElement>(":scope > .ic-image-composer__input--image"));
  if (!imageItems.length) return 0;
  const firstRect = imageItems[0].getBoundingClientRect();
  if (clientX <= firstRect.left + firstRect.width / 2) return 0;
  for (let index = 1; index < imageItems.length; index += 1) {
    const rect = imageItems[index].getBoundingClientRect();
    if (clientX <= rect.left + rect.width / 2) return index;
  }
  return imageItems.length;
}

export function ReferenceImageStrip({
  imageItems,
  promptItems = [],
  targetId,
  draggedConnectionId,
  className = "",
  uploadButton,
  ariaLabel,
  deleteLabel,
  onRemove,
  onReorder,
  onDraggedConnectionIdChange,
}: ReferenceImageStripProps) {
  const [insertIndex, setInsertIndex] = useState<number | null>(null);
  const insertIndexRef = useRef<number | null>(null);
  const visualOffset = promptItems.length + (uploadButton ? 1 : 0);

  const updateInsertIndex = (index: number | null) => {
    insertIndexRef.current = index;
    setInsertIndex(index);
  };

  return (
    <div
      className={`ic-reference-image-strip ic-image-composer__inputs nopan nowheel${className ? ` ${className}` : ""}${draggedConnectionId ? " sorting" : ""}${insertIndex !== null ? " has-insert" : ""}`}
      aria-label={ariaLabel}
      style={insertIndex !== null ? {
        "--ic-input-insert-index": insertIndex,
        "--ic-prompt-input-count": visualOffset,
      } as CSSProperties : undefined}
      onDragOver={(event) => {
        if (!draggedConnectionId) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        updateInsertIndex(getInsertIndex(event.currentTarget, event.clientX));
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        updateInsertIndex(null);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const connectionId = event.dataTransfer.getData("text/plain");
        onReorder(targetId, connectionId, insertIndexRef.current ?? getInsertIndex(event.currentTarget, event.clientX));
        onDraggedConnectionIdChange("");
        updateInsertIndex(null);
      }}
    >
      {uploadButton}
      {promptItems.map((item) => (
        <div
          key={item.connectionId}
          className="ic-image-composer__input ic-image-composer__input--prompt nodrag"
          title={item.title}
        >
          <span>{item.title}</span>
          <p>{item.text}</p>
          <button
            type="button"
            className="ic-image-composer__input-remove"
            aria-label={deleteLabel}
            title={deleteLabel}
            draggable={false}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemove(item.connectionId);
            }}
          >
            <X size={11} aria-hidden="true" />
          </button>
        </div>
      ))}
      {imageItems.map((item) => (
        <ReferenceImageHoverPreview
          key={item.connectionId}
          className={`ic-image-composer__input ic-image-composer__input--image nodrag${draggedConnectionId === item.connectionId ? " dragging" : ""}`}
          title={item.title}
          previewSrc={item.url}
          previewAlt={item.title}
          draggable
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", item.connectionId);
            onDraggedConnectionIdChange(item.connectionId);
            updateInsertIndex(item.order - 1);
          }}
          onDragEnd={() => {
            onDraggedConnectionIdChange("");
            updateInsertIndex(null);
          }}
        >
          <img src={item.url} alt={item.title} draggable={false} />
          <span className="ic-image-composer__input-order">{item.order}</span>
          <button
            type="button"
            className="ic-image-composer__input-remove"
            aria-label={deleteLabel}
            title={deleteLabel}
            draggable={false}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRemove(item.connectionId);
            }}
          >
            <X size={11} aria-hidden="true" />
          </button>
        </ReferenceImageHoverPreview>
      ))}
    </div>
  );
}

export function ReferenceImageUploadButton({
  ariaLabel,
  title,
  onClick,
}: {
  ariaLabel: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="ic-reference-image-upload"
      aria-label={ariaLabel}
      title={title}
      onClick={onClick}
    >
      <ImagePlus size={16} aria-hidden="true" />
    </button>
  );
}
