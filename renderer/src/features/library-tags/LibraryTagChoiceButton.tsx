import { Ban } from "lucide-react";
import { Button } from "../../components/ui/button";
import { normalizeLibraryTagColor, type LibraryTagColor } from "./tagColors";

interface LibraryTagChoiceButtonBaseProps {
  name: string;
  color?: LibraryTagColor | string | null;
  count?: number;
  role?: string;
}

type LibraryTagChoiceButtonProps = LibraryTagChoiceButtonBaseProps & (
  | {
      mode?: "filter";
      included: boolean;
      excluded: boolean;
      onToggleInclude: () => void;
      onToggleExclude: () => void;
    }
  | {
      mode: "select";
      selected: boolean;
      onToggleSelect: () => void;
    }
);

export function LibraryTagChoiceButton(props: LibraryTagChoiceButtonProps) {
  const { name, color, count, role } = props;
  const selectMode = props.mode === "select";
  const included = selectMode ? props.selected : props.included;
  const excluded = selectMode ? false : props.excluded;
  const selected = included || excluded;
  const disabled = count !== undefined && count <= 0 && !selected;
  const togglePrimary = selectMode ? props.onToggleSelect : props.onToggleInclude;

  return (
    <div className={`library-tag-choice${selectMode ? " library-tag-choice--select" : ""}${included ? " library-tag-choice--include" : ""}${excluded ? " library-tag-choice--exclude" : ""}${disabled ? " library-tag-choice--empty" : ""}`}>
      <Button
        className="library-tag-choice__include"
        type="button"
        variant="ghost"
        role={role}
        aria-pressed={role ? undefined : selected}
        aria-checked={role ? selected : undefined}
        disabled={disabled}
        onClick={togglePrimary}
      >
        <span className={`library-tag-color-dot library-tag-choice__color-dot library-tag-color-dot--${normalizeLibraryTagColor(color)}`} aria-hidden="true" />
        <span className="library-tag-choice__label">{name}</span>
        {count !== undefined ? <span className="library-tag-choice__count">{count}</span> : null}
      </Button>
      {!selectMode ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={disabled}
          className="library-tag-choice__exclude"
          aria-label={`${name}: exclude`}
          title={`${name}: exclude`}
          onClick={(event) => {
            event.stopPropagation();
            props.onToggleExclude();
          }}
        >
          <Ban aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
