import { memo } from "react";
import { useCanvasStore } from "../canvasStore";
import { useCanvasUiStore } from "../canvasUiStore";
import { linkPath, tempLinkPath, WORLD_CENTER, WORLD_SIZE } from "../canvasGeometry";
import type { CanvasConnection } from "../types";

export interface LinkDraftView {
  from: string;
  x: number;
  y: number;
}

interface ConnectionLayerProps {
  visibleConnectionIds?: readonly string[];
  showConnections: boolean;
  linkDraft: LinkDraftView | null;
  selectConnectionLabel: string;
  onSelectConnection: (event: React.PointerEvent<SVGPathElement>, connection: CanvasConnection) => void;
  onFocusConnection: (connection: CanvasConnection) => void;
  onMoveSelectedConnection: (connectionId: string, clientX: number, clientY: number) => void;
}

interface ConnectionItemProps {
  connectionId: string;
  selectConnectionLabel: string;
  onSelectConnection: (event: React.PointerEvent<SVGPathElement>, connection: CanvasConnection) => void;
  onFocusConnection: (connection: CanvasConnection) => void;
  onMoveSelectedConnection: (connectionId: string, clientX: number, clientY: number) => void;
}

const ConnectionItem = memo(function ConnectionItem({
  connectionId,
  selectConnectionLabel,
  onSelectConnection,
  onFocusConnection,
  onMoveSelectedConnection,
}: ConnectionItemProps) {
  const connection = useCanvasStore((state) => state.connectionLookup.get(connectionId));
  const from = useCanvasStore((state) => {
    const currentConnection = state.connectionLookup.get(connectionId);
    return currentConnection ? state.nodeLookup.get(currentConnection.from) : undefined;
  });
  const to = useCanvasStore((state) => {
    const currentConnection = state.connectionLookup.get(connectionId);
    return currentConnection ? state.nodeLookup.get(currentConnection.to) : undefined;
  });
  const related = useCanvasUiStore((state) => {
    if (!connection) return false;
    return state.selectedIds.has(connection.from) || state.selectedIds.has(connection.to);
  });
  const selected = useCanvasUiStore((state) => state.selectedConnectionId === connectionId);

  if (!connection || !from || !to) return null;
  const path = linkPath(from, to);

  return (
    <g className="ic-link-group">
      <path
        className="ic-link-hit"
        d={path}
        role="button"
        tabIndex={0}
        aria-label={selectConnectionLabel}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          onSelectConnection(event, connection);
        }}
        onPointerEnter={(event) => {
          if (selected) onMoveSelectedConnection(connection.id, event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (selected) onMoveSelectedConnection(connection.id, event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onFocusConnection(connection);
        }}
      />
      <path className={`ic-link${related || selected ? " related" : ""}${selected ? " selected" : ""}`} d={path} />
    </g>
  );
});

export const ConnectionLayer = memo(function ConnectionLayer({
  visibleConnectionIds,
  showConnections,
  linkDraft,
  selectConnectionLabel,
  onSelectConnection,
  onFocusConnection,
  onMoveSelectedConnection,
}: ConnectionLayerProps) {
  const storeConnectionIds = useCanvasStore((state) => state.connectionIds);
  const connectionIds = visibleConnectionIds || storeConnectionIds;
  const draftFrom = useCanvasStore((state) => (linkDraft ? state.nodeLookup.get(linkDraft.from) : undefined));

  return (
    <svg className={`ic-links${showConnections ? "" : " is-hidden"}`} viewBox={`${-WORLD_CENTER} ${-WORLD_CENTER} ${WORLD_SIZE} ${WORLD_SIZE}`}>
      {showConnections ? connectionIds.map((connectionId) => (
        <ConnectionItem
          key={connectionId}
          connectionId={connectionId}
          selectConnectionLabel={selectConnectionLabel}
          onSelectConnection={onSelectConnection}
          onFocusConnection={onFocusConnection}
          onMoveSelectedConnection={onMoveSelectedConnection}
        />
      )) : null}
      {linkDraft && draftFrom ? <path className="ic-link ic-link--temp" d={tempLinkPath(draftFrom, linkDraft.x, linkDraft.y)} /> : null}
    </svg>
  );
});
