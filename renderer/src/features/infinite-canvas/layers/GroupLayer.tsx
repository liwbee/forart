import { Layers, Ungroup } from "lucide-react";
import { memo, PointerEvent } from "react";
import type { useTranslation } from "react-i18next";
import { useCanvasStore } from "../canvasStore";
import { useCanvasUiStore } from "../canvasUiStore";
import { getGroupBounds, WORLD_CENTER } from "../canvasGeometry";
import type { CanvasGroup } from "../types";

interface GroupLayerProps {
  editingGroupId: string;
  onEditingGroupChange: (groupId: string) => void;
  onPatchGroup: (groupId: string, patch: Partial<CanvasGroup>) => void;
  onStartGroupDrag: (event: PointerEvent<HTMLElement>, group: CanvasGroup) => void;
  onStartGroupResize: (event: PointerEvent<HTMLButtonElement>, group: CanvasGroup) => void;
  onUngroup: (groupId: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
}

interface GroupItemProps extends GroupLayerProps {
  groupId: string;
}

const GroupItem = memo(function GroupItem({
  groupId,
  editingGroupId,
  onEditingGroupChange,
  onPatchGroup,
  onStartGroupDrag,
  onStartGroupResize,
  onUngroup,
  t,
}: GroupItemProps) {
  const group = useCanvasStore((state) => state.groupLookup.get(groupId));
  const selected = useCanvasUiStore((state) => state.selectedGroupId === groupId);
  const setSelectedGroupId = useCanvasUiStore((state) => state.setSelectedGroupId);
  if (!group) return null;

  const bounds = getGroupBounds(group);
  if (!bounds) return null;
  const isEditing = editingGroupId === group.id;

  return (
    <div
      className={`ic-group-frame${selected ? " selected" : ""}`}
      style={{
        left: WORLD_CENTER + bounds.x,
        top: WORLD_CENTER + bounds.y,
        width: bounds.width,
        height: bounds.height,
      }}
      onPointerDown={(event) => onStartGroupDrag(event, group)}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setSelectedGroupId(group.id);
        onEditingGroupChange(group.id);
      }}
    >
      <div className="ic-group-frame__head nodrag" onPointerDown={(event) => onStartGroupDrag(event, group)}>
        {isEditing ? (
          <input
            value={group.title}
            autoFocus
            maxLength={80}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => onPatchGroup(group.id, { title: event.target.value })}
            onBlur={() => onEditingGroupChange("")}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onEditingGroupChange("");
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onEditingGroupChange("");
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="ic-group-frame__title"
            onPointerDown={(event) => onStartGroupDrag(event, group)}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onEditingGroupChange(group.id);
            }}
          >
            <Layers size={13} aria-hidden="true" />
            <span>{group.title}</span>
          </button>
        )}
        {selected ? (
          <button
            type="button"
            className="ic-group-frame__action"
            aria-label={t("infiniteCanvas.ungroup")}
            title={t("infiniteCanvas.ungroup")}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onUngroup(group.id)}
          >
            <Ungroup size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {selected ? (
        <button
          className="ic-group-resize-handle nodrag"
          type="button"
          aria-label={t("infiniteCanvas.resizeNode")}
          onPointerDown={(event) => onStartGroupResize(event, group)}
        />
      ) : null}
    </div>
  );
});

export const GroupLayer = memo(function GroupLayer(props: GroupLayerProps) {
  const groupIds = useCanvasStore((state) => state.groupIds);
  return (
    <>
      {groupIds.map((groupId) => (
        <GroupItem key={groupId} {...props} groupId={groupId} />
      ))}
    </>
  );
});
