import { useCallback, useMemo, useState } from "react";

export function useLibraryBulkSelection() {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const selectedIdList = useMemo(() => Array.from(selectedIds), [selectedIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const enterSelectionMode = useCallback(() => {
    setSelectionMode(true);
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((current) => {
      if (current) setSelectedIds(new Set());
      return !current;
    });
  }, []);

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectMatching = useCallback((ids: string[]) => {
    setSelectionMode(true);
    setSelectedIds(new Set(ids));
  }, []);

  const pruneSelection = useCallback((validIds: string[]) => {
    const validIdSet = new Set(validIds);
    setSelectedIds((current) => {
      const next = new Set(Array.from(current).filter((id) => validIdSet.has(id)));
      return next.size === current.size ? current : next;
    });
  }, []);

  return {
    selectionMode,
    selectedIds,
    selectedIdList,
    selectedCount: selectedIds.size,
    setSelectionMode,
    enterSelectionMode,
    exitSelectionMode,
    toggleSelectionMode,
    toggleSelected,
    selectMatching,
    clearSelection,
    pruneSelection,
  };
}
