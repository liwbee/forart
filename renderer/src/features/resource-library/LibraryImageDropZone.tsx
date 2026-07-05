import { DragEvent, ReactNode, useState } from "react";
import { ImagePlus } from "lucide-react";

function firstImageFile(files: FileList | null) {
  if (!files?.length) return null;
  return Array.from(files).find((file) => file.type.startsWith("image/")) || null;
}

function hasImageItem(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.items || []).some((item) => item.kind === "file" && item.type.startsWith("image/"));
}

export function LibraryImageDropZone({
  children,
  disabled,
  label,
  onDropImage,
}: {
  children: ReactNode;
  disabled: boolean;
  label: string;
  onDropImage: (file: File) => void;
}) {
  const [dragDepth, setDragDepth] = useState(0);
  const active = !disabled && dragDepth > 0;

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!hasImageItem(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (disabled) return;
    setDragDepth((depth) => depth + 1);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasImageItem(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = disabled ? "none" : "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (disabled || dragDepth <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    setDragDepth((depth) => Math.max(0, depth - 1));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    const file = firstImageFile(event.dataTransfer.files);
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    setDragDepth(0);
    if (disabled) return;
    onDropImage(file);
  }

  return (
    <div
      className={`library-image-drop-zone${active ? " is-active" : ""}`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {active ? (
        <div className="library-image-drop-zone__overlay" aria-hidden="true">
          <div>
            <ImagePlus size={28} aria-hidden="true" />
            <span>{label}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
