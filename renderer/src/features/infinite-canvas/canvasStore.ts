import { create } from "zustand";
import { temporal } from "zundo";
import type { CanvasConnection, CanvasGroup, CanvasNode } from "./types";

type StateUpdater<T> = T | ((current: T) => T);

export interface CanvasDocument {
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  groups: CanvasGroup[];
}

interface CanvasIndexes {
  nodeIds: string[];
  connectionIds: string[];
  groupIds: string[];
  nodeLookup: Map<string, CanvasNode>;
  connectionLookup: Map<string, CanvasConnection>;
  groupLookup: Map<string, CanvasGroup>;
}

type CanvasHistoryState = CanvasDocument & CanvasIndexes;

interface CanvasStore extends CanvasDocument {
  nodeIds: string[];
  connectionIds: string[];
  groupIds: string[];
  nodeLookup: Map<string, CanvasNode>;
  connectionLookup: Map<string, CanvasConnection>;
  groupLookup: Map<string, CanvasGroup>;
  setCanvasDocument: (updater: StateUpdater<CanvasDocument>) => void;
  setCanvasDocumentWithoutHistory: (updater: StateUpdater<CanvasDocument>) => void;
  setNodes: (updater: StateUpdater<CanvasNode[]>) => void;
  setNodesWithoutHistory: (updater: StateUpdater<CanvasNode[]>) => void;
  setConnections: (updater: StateUpdater<CanvasConnection[]>) => void;
  setGroups: (updater: StateUpdater<CanvasGroup[]>) => void;
}

function resolveUpdater<T>(updater: StateUpdater<T>, current: T) {
  return typeof updater === "function" ? (updater as (value: T) => T)(current) : updater;
}

function createCanvasIndexes(document: CanvasDocument): CanvasIndexes {
  return {
    nodeIds: document.nodes.map((node) => node.id),
    connectionIds: document.connections.map((connection) => connection.id),
    groupIds: document.groups.map((group) => group.id),
    nodeLookup: new Map(document.nodes.map((node) => [node.id, node])),
    connectionLookup: new Map(document.connections.map((connection) => [connection.id, connection])),
    groupLookup: new Map(document.groups.map((group) => [group.id, group])),
  };
}

function idsEqual<T extends { id: string }>(items: T[], ids: string[]) {
  return items.length === ids.length && items.every((item, index) => item.id === ids[index]);
}

function withCanvasIndexes(document: CanvasDocument): CanvasHistoryState {
  return {
    ...document,
    ...createCanvasIndexes(document),
  };
}

function isCanvasDocumentEqual(a: CanvasDocument, b: CanvasDocument) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const useCanvasStore = create<CanvasStore>()(
  temporal(
    (set, get) => ({
      nodes: [],
      connections: [],
      groups: [],
      ...createCanvasIndexes({ nodes: [], connections: [], groups: [] }),
      setCanvasDocument: (updater) => {
        set((state) => withCanvasIndexes(resolveUpdater(updater, { nodes: state.nodes, connections: state.connections, groups: state.groups })));
      },
      setCanvasDocumentWithoutHistory: (updater) => {
        const temporalState = useCanvasStore.temporal.getState();
        temporalState.pause();
        set((state) => withCanvasIndexes(resolveUpdater(updater, { nodes: state.nodes, connections: state.connections, groups: state.groups })));
        temporalState.resume();
      },
      setNodes: (updater) => {
        set((state) => {
          const nodes = resolveUpdater(updater, state.nodes);
          return {
            nodes,
            connections: state.connections,
            groups: state.groups,
            nodeIds: idsEqual(nodes, state.nodeIds) ? state.nodeIds : nodes.map((node) => node.id),
            connectionIds: state.connectionIds,
            groupIds: state.groupIds,
            nodeLookup: new Map(nodes.map((node) => [node.id, node])),
            connectionLookup: state.connectionLookup,
            groupLookup: state.groupLookup,
          };
        });
      },
      setNodesWithoutHistory: (updater) => {
        const temporalState = useCanvasStore.temporal.getState();
        temporalState.pause();
        set((state) => {
          const nodes = resolveUpdater(updater, state.nodes);
          return {
            nodes,
            connections: state.connections,
            groups: state.groups,
            nodeIds: idsEqual(nodes, state.nodeIds) ? state.nodeIds : nodes.map((node) => node.id),
            connectionIds: state.connectionIds,
            groupIds: state.groupIds,
            nodeLookup: new Map(nodes.map((node) => [node.id, node])),
            connectionLookup: state.connectionLookup,
            groupLookup: state.groupLookup,
          };
        });
        temporalState.resume();
      },
      setConnections: (updater) => {
        set((state) => {
          const connections = resolveUpdater(updater, state.connections);
          return {
            nodes: state.nodes,
            connections,
            groups: state.groups,
            nodeIds: state.nodeIds,
            connectionIds: idsEqual(connections, state.connectionIds) ? state.connectionIds : connections.map((connection) => connection.id),
            groupIds: state.groupIds,
            nodeLookup: state.nodeLookup,
            connectionLookup: new Map(connections.map((connection) => [connection.id, connection])),
            groupLookup: state.groupLookup,
          };
        });
      },
      setGroups: (updater) => {
        set((state) => {
          const groups = resolveUpdater(updater, state.groups);
          return {
            nodes: state.nodes,
            connections: state.connections,
            groups,
            nodeIds: state.nodeIds,
            connectionIds: state.connectionIds,
            groupIds: idsEqual(groups, state.groupIds) ? state.groupIds : groups.map((group) => group.id),
            nodeLookup: state.nodeLookup,
            connectionLookup: state.connectionLookup,
            groupLookup: new Map(groups.map((group) => [group.id, group])),
          };
        });
      },
    }),
    {
      partialize: (state): CanvasHistoryState => withCanvasIndexes({
        nodes: state.nodes,
        connections: state.connections,
        groups: state.groups,
      }),
      equality: isCanvasDocumentEqual,
      limit: 100,
    },
  ),
);

let initialized = false;

export function ensureCanvasDocument(document: CanvasDocument) {
  if (initialized) return;
  replaceCanvasDocument(document);
  initialized = true;
}

export function replaceCanvasDocument(document: CanvasDocument) {
  const temporalState = useCanvasStore.temporal.getState();
  temporalState.pause();
  useCanvasStore.setState(withCanvasIndexes(document));
  temporalState.clear();
  temporalState.resume();
}

export function commitCanvasDocumentChange(previous: CanvasDocument) {
  const current = {
    nodes: useCanvasStore.getState().nodes,
    connections: useCanvasStore.getState().connections,
    groups: useCanvasStore.getState().groups,
  };
  if (isCanvasDocumentEqual(previous, current)) return;
  useCanvasStore.temporal.setState((state) => ({
    pastStates: [...state.pastStates, withCanvasIndexes(previous)].slice(-100),
    futureStates: [],
  }));
}

export function undoCanvasHistory() {
  useCanvasStore.temporal.getState().undo();
}

export function redoCanvasHistory() {
  useCanvasStore.temporal.getState().redo();
}
