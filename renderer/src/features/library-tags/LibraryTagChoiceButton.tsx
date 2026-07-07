import { Ban } from "lucide-react";
import { normalizeLibraryTagColor, type LibraryTagColor } from "./tagColors";

interface LibraryTagChoiceButtonProps {
  name: string;
  color?: LibraryTagColor | string | null;
  count?: number;
  included: boolean;
  excluded: boolean;
  onToggleInclude: () => void;
  onToggleExclude: () => void;
  role?: string;
}

export function LibraryTagChoiceButton({
  name,
  color,
  count,
  included,
  excluded,
  onToggleInclude,
  onToggleExclude,
  role,
}: LibraryTagChoiceButtonProps) {
  return (
    <button
      className={`library-tag-choice${included ? " library-tag-choice--include" : ""}${excluded ? " library-tag-choice--exclude" : ""}`}
      type="button"
      role={role}
      aria-pressed={role ? undefined : included || excluded}
      aria-checked={role ? included || excluded : undefined}
      onClick={onToggleInclude}
    >
      <span className={`library-tag-color-dot library-tag-color-dot--${normalizeLibraryTagColor(color)}`} aria-hidden="true" />
      <span>{name}</span>
      {count !== undefined ? <span className="library-tag-choice__count">{count}</span> : null}
      <span
        role="button"
        tabIndex={0}
        className="library-tag-choice__exclude"
        aria-label={`排除 ${name}`}
        title={`排除 ${name}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggleExclude();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          onToggleExclude();
        }}
      >
        <Ban size={12} aria-hidden="true" />
      </span>
    </button>
  );
}
