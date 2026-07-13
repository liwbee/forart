import { FolderOpen, HardDrive, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type CanvasCacheAsset, type CanvasCacheDeleteResult, type CanvasCacheScanResult } from "../../app/appConfig";
import { ConfirmingDeleteButton } from "../../components/ConfirmingDeleteButton";
import { ErrorCopyLine } from "../../components/ErrorCopyLine";
import { NativeTabs, type NativeTabItem } from "../../components/NativeTabs";
import { VirtualList } from "../../components/VirtualList";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/skeleton";

interface StatusState {
  tone: "idle" | "ready" | "error" | "busy";
  text: string;
}

type CacheAction = "scan" | "delete" | "open-root" | "";
type CacheKindFilter = "all" | "input" | "output";
type CacheStatusFilter = "all" | "referenced" | "cleanable" | "missing";

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatCacheTime(timestamp: number) {
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function CacheSettingsPanel() {
  const { t } = useTranslation();
  const [cacheScan, setCacheScan] = useState<CanvasCacheScanResult | null>(null);
  const [cacheAction, setCacheAction] = useState<CacheAction>("");
  const [initialScanComplete, setInitialScanComplete] = useState(false);
  const [cacheStatus, setCacheStatus] = useState<StatusState>({ tone: "idle", text: t("settings:cacheReady") });
  const [cacheKindFilter, setCacheKindFilter] = useState<CacheKindFilter>("all");
  const [cacheStatusFilter, setCacheStatusFilter] = useState<CacheStatusFilter>("all");
  const [selectedCacheAssetIds, setSelectedCacheAssetIds] = useState<Set<string>>(new Set());
  const cacheKindTabs = useMemo<NativeTabItem<CacheKindFilter>[]>(() => [
    { value: "all", label: t("common:labels.all") },
    { value: "input", label: t("settings:cacheKindInput") },
    { value: "output", label: t("settings:cacheKindOutput") },
  ], [t]);
  const cacheStatusTabs = useMemo<NativeTabItem<CacheStatusFilter>[]>(() => [
    { value: "all", label: t("common:labels.all") },
    { value: "referenced", label: t("settings:cacheStatusReferenced") },
    { value: "cleanable", label: t("settings:cacheStatusCleanable") },
    { value: "missing", label: t("settings:cacheStatusMissing") },
  ], [t]);
  const cacheAssets = useMemo(() => {
    if (!cacheScan) return [];
    return [...cacheScan.assets, ...cacheScan.missingReferences];
  }, [cacheScan]);
  const filteredCacheAssets = useMemo(() => cacheAssets.filter((asset) => {
    if (cacheKindFilter !== "all" && asset.kind !== cacheKindFilter) return false;
    if (cacheStatusFilter === "referenced" && (!asset.exists || !asset.referenced)) return false;
    if (cacheStatusFilter === "cleanable" && (!asset.exists || asset.referenced)) return false;
    if (cacheStatusFilter === "missing" && asset.exists) return false;
    return true;
  }), [cacheAssets, cacheKindFilter, cacheStatusFilter]);
  const selectedCacheAssets = useMemo(() => cacheAssets.filter((asset) => selectedCacheAssetIds.has(asset.id)), [cacheAssets, selectedCacheAssetIds]);
  const selectedCleanableCacheAssets = useMemo(() => selectedCacheAssets.filter((asset) => asset.exists && !asset.referenced), [selectedCacheAssets]);

  const scanCanvasCache = useCallback(async (nextStatus?: StatusState) => {
    setCacheAction("scan");
    setCacheStatus({ tone: "busy", text: t("settings:cacheScanning") });
    try {
      if (!window.easyTool?.scanCanvasCache) throw new Error(t("settings:cacheBridgeUnavailable"));
      const result = await window.easyTool.scanCanvasCache();
      setCacheScan(result);
      setSelectedCacheAssetIds(new Set());
      setCacheStatus(nextStatus || { tone: "ready", text: t("settings:cacheScanComplete", { count: result.assets.length, cleanable: result.totals.cleanableCount }) });
    } catch (error) {
      setCacheStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setCacheAction("");
      setInitialScanComplete(true);
    }
  }, [t]);

  useEffect(() => {
    void scanCanvasCache();
  }, [scanCanvasCache]);

  async function deleteCacheAssets(assets: CanvasCacheAsset[], action: CacheAction, confirmed = false) {
    const cleanable = assets.filter((asset) => asset.exists && !asset.referenced);
    if (!cleanable.length) {
      setCacheStatus({ tone: "idle", text: t("settings:cacheNoCleanableSelected") });
      return;
    }
    const totalBytes = cleanable.reduce((sum, asset) => sum + asset.sizeBytes, 0);
    if (!confirmed && !window.confirm(t("settings:cacheDeleteConfirm", { count: cleanable.length, size: formatBytes(totalBytes) }))) return;

    setCacheAction(action);
    setCacheStatus({ tone: "busy", text: t("settings:cacheDeleting") });
    try {
      if (!window.easyTool?.deleteCanvasCacheAssets) throw new Error(t("settings:cacheBridgeUnavailable"));
      const result: CanvasCacheDeleteResult = await window.easyTool.deleteCanvasCacheAssets({ ids: cleanable.map((asset) => asset.id) });
      await scanCanvasCache({
        tone: result.failedCount ? "error" : "ready",
        text: t("settings:cacheDeleteComplete", {
          deleted: result.deletedCount,
          skipped: result.skippedCount,
          failed: result.failedCount,
          size: formatBytes(result.freedBytes),
        }),
      });
    } catch (error) {
      setCacheStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setCacheAction("");
    }
  }

  async function openCanvasCacheRoot() {
    setCacheAction("open-root");
    try {
      if (!window.easyTool?.openCanvasCacheRoot) throw new Error(t("settings:cacheBridgeUnavailable"));
      await window.easyTool.openCanvasCacheRoot();
    } catch (error) {
      setCacheStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setCacheAction("");
    }
  }

  async function revealCanvasCacheAsset(asset: CanvasCacheAsset) {
    try {
      if (!window.easyTool?.revealCanvasCacheAsset) throw new Error(t("settings:cacheBridgeUnavailable"));
      await window.easyTool.revealCanvasCacheAsset({ id: asset.id, filePath: asset.filePath });
    } catch (error) {
      setCacheStatus({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  function toggleCacheAssetSelection(asset: CanvasCacheAsset) {
    if (!asset.exists || asset.referenced) return;
    setSelectedCacheAssetIds((current) => {
      const next = new Set(current);
      if (next.has(asset.id)) next.delete(asset.id);
      else next.add(asset.id);
      return next;
    });
  }

  function cacheKindLabel(kind: CanvasCacheAsset["kind"]) {
    if (kind === "input") return t("settings:cacheKindInput");
    if (kind === "output") return t("settings:cacheKindOutput");
    return t("settings:cacheKindMissing");
  }

  function cacheStatusLabel(asset: CanvasCacheAsset) {
    if (!asset.exists) return t("settings:cacheStatusMissing");
    if (asset.referenced) return t("settings:cacheStatusReferenced");
    return t("settings:cacheStatusCleanable");
  }

  function renderCacheMetric(label: string, count: number, bytes?: number) {
    return (
      <div className="settings-cache-metric">
        <span>{label}</span>
        <strong>{count}</strong>
        {bytes !== undefined ? <small>{formatBytes(bytes)}</small> : null}
      </div>
    );
  }

  const cleanableAssets = cacheScan?.assets.filter((asset) => asset.exists && !asset.referenced) || [];
  const allVisibleCleanableSelected = filteredCacheAssets.some((asset) => asset.exists && !asset.referenced)
    && filteredCacheAssets.filter((asset) => asset.exists && !asset.referenced).every((asset) => selectedCacheAssetIds.has(asset.id));
  const renderCacheAssetRow = (asset: CanvasCacheAsset) => {
    const canDelete = asset.exists && !asset.referenced;
    return (
      <article className={`settings-cache-row${!asset.exists ? " settings-cache-row--missing" : ""}`}>
        <label className="settings-cache-row-select" aria-label={t("settings:cacheSelectAsset")}>
          <input type="checkbox" checked={selectedCacheAssetIds.has(asset.id)} disabled={!canDelete} onChange={() => toggleCacheAssetSelection(asset)} />
        </label>
        <div className="settings-cache-thumb">
          {asset.exists ? <img src={asset.thumbUrl || asset.url} alt={asset.fileName} loading="lazy" decoding="async" /> : <HardDrive size={20} aria-hidden="true" />}
        </div>
        <div className="settings-cache-info">
          <div className="settings-cache-title-line">
            <strong title={asset.fileName}>{asset.fileName}</strong>
            <span className={`settings-cache-pill settings-cache-pill--${asset.exists ? asset.referenced ? "referenced" : "cleanable" : "missing"}`}>{cacheStatusLabel(asset)}</span>
            <span className="settings-cache-pill">{cacheKindLabel(asset.kind)}</span>
          </div>
          <div className="settings-cache-meta">
            <span>{formatBytes(asset.sizeBytes)}</span>
            <span>{formatCacheTime(asset.modifiedAt)}</span>
            <span>{t("settings:cacheReferenceCount", { count: asset.references.length })}</span>
          </div>
          <div className="settings-cache-reference-line" title={asset.references.map((reference) => `${reference.canvasTitle || reference.canvasId}${reference.nodeTitle ? ` / ${reference.nodeTitle}` : ""}`).join("\n")}>
            {asset.references.length ? asset.references.slice(0, 3).map((reference) => reference.canvasTitle || reference.canvasId || "-").join(" / ") : t("settings:cacheNoReferences")}
          </div>
        </div>
        <div className="settings-cache-row-actions">
          <Button type="button" variant="ghost" size="icon-sm" disabled={!asset.filePath} aria-label={t("settings:cacheShowInFolder")} title={t("settings:cacheShowInFolder")} onClick={() => revealCanvasCacheAsset(asset)}>
            <FolderOpen aria-hidden="true" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" disabled={!canDelete || cacheAction !== ""} aria-label={t("common:actions.delete")} title={canDelete ? t("common:actions.delete") : t("settings:cacheReferencedCannotDelete")} onClick={() => deleteCacheAssets([asset], "delete")}>
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </article>
    );
  };

  if (!initialScanComplete) {
    return (
      <div className="settings-cache-layout" role="tabpanel" aria-label={t("settings:cacheCleanup")} aria-busy="true">
        <section className="settings-section settings-cache-section">
          <div className="settings-cache-status-row">
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-8 flex-1" />
          </div>
          <div className="settings-cache-summary">
            {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-[86px] w-full" />)}
          </div>
          <div className="settings-cache-toolbar">
            <Skeleton className="h-9 w-52" />
            <Skeleton className="h-9 w-72" />
            <div className="settings-cache-toolbar-actions">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>
          <Skeleton className="h-9 w-full" />
          <div className="grid gap-2">
            {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-[98px] w-full" />)}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="settings-cache-layout" role="tabpanel" aria-label={t("settings:cacheCleanup")}>
      <section className="settings-section settings-cache-section">
        <div className="settings-cache-status-row">
          <Button type="button" variant="ghost" size="icon-sm" disabled={cacheAction !== ""} aria-label={t("settings:cacheRefresh")} title={t("settings:cacheRefresh")} onClick={() => void scanCanvasCache()}>
            <RefreshCw className={cacheAction === "scan" ? "animate-spin" : undefined} aria-hidden="true" />
          </Button>
          {cacheStatus.tone === "error" ? (
            <ErrorCopyLine className="settings-inline-status settings-cache-action-status" text={cacheStatus.text} ariaLive="polite" />
          ) : (
            <div className="settings-inline-status settings-cache-action-status" data-tone={cacheStatus.tone} aria-live="polite">
              {cacheStatus.text}
            </div>
          )}
        </div>

        <div className="settings-cache-summary">
          {renderCacheMetric(t("settings:cacheInputImages"), cacheScan?.totals.inputCount || 0, cacheScan?.totals.inputBytes || 0)}
          {renderCacheMetric(t("settings:cacheOutputImages"), cacheScan?.totals.outputCount || 0, cacheScan?.totals.outputBytes || 0)}
          {renderCacheMetric(t("settings:cacheReferencedImages"), cacheScan?.totals.referencedCount || 0, cacheScan?.totals.referencedBytes || 0)}
          {renderCacheMetric(t("settings:cacheCleanableImages"), cacheScan?.totals.cleanableCount || 0, cacheScan?.totals.cleanableBytes || 0)}
          {renderCacheMetric(t("settings:cacheMissingImages"), cacheScan?.totals.missingReferenceCount || 0)}
        </div>

        <div className="settings-cache-toolbar">
          <NativeTabs items={cacheKindTabs} value={cacheKindFilter} onChange={setCacheKindFilter} ariaLabel={t("settings:cacheKindFilter")} className="settings-cache-tabs" />
          <NativeTabs items={cacheStatusTabs} value={cacheStatusFilter} onChange={setCacheStatusFilter} ariaLabel={t("settings:cacheStatusFilter")} className="settings-cache-tabs settings-cache-tabs--status" />
          <div className="settings-cache-toolbar-actions">
            <ConfirmingDeleteButton
              className="settings-cache-confirm-delete"
              disabled={cacheAction !== "" || !cleanableAssets.length}
              isBusy={cacheAction === "delete"}
              label={t("settings:cacheDeleteAllCleanable")}
              confirmLabel={t("common:bulk.confirmDelete")}
              busyLabel={t("settings:cacheDeleting")}
              resetKey={cleanableAssets.length}
              cancelLabel={t("common:actions.cancel")}
              onDelete={() => deleteCacheAssets(cleanableAssets, "delete", true)}
            />
            <Button type="button" variant="default" disabled={cacheAction !== ""} onClick={openCanvasCacheRoot}>
              <FolderOpen data-icon="inline-start" aria-hidden="true" />
              <span>{t("settings:cacheOpenRoot")}</span>
            </Button>
          </div>
        </div>

        <div className="settings-cache-list-head">
          <label>
            <input
              type="checkbox"
              checked={allVisibleCleanableSelected}
              disabled={!filteredCacheAssets.some((asset) => asset.exists && !asset.referenced)}
              onChange={() => {
                const visibleCleanable = filteredCacheAssets.filter((asset) => asset.exists && !asset.referenced);
                setSelectedCacheAssetIds((current) => {
                  const next = new Set(current);
                  if (allVisibleCleanableSelected) visibleCleanable.forEach((asset) => next.delete(asset.id));
                  else visibleCleanable.forEach((asset) => next.add(asset.id));
                  return next;
                });
              }}
            />
            <span>{t("settings:cacheVisibleCount", { count: filteredCacheAssets.length })}</span>
          </label>
          <span>{cacheScan?.rootPath || ""}</span>
        </div>

        <VirtualList
          items={filteredCacheAssets}
          className="settings-cache-list settings-virtual-list"
          viewportClassName="settings-virtual-list__viewport settings-cache-list__viewport"
          estimateSize={106}
          overscan={6}
          measureItems
          getItemKey={(asset) => asset.id}
          renderItem={renderCacheAssetRow}
          spacerClassName="settings-virtual-list__spacer"
          itemClassName="settings-virtual-list__item"
          empty={(
            <div className="settings-empty-state">
              <HardDrive size={22} aria-hidden="true" />
              <p>{cacheAction === "scan" ? t("settings:cacheScanning") : t("settings:cacheNoAssets")}</p>
            </div>
          )}
        />

        {selectedCacheAssetIds.size ? (
          <div className="settings-cache-selection-bar">
            <span>{t("settings:cacheSelectedSummary", { selected: selectedCacheAssetIds.size, cleanable: selectedCleanableCacheAssets.length, size: formatBytes(selectedCleanableCacheAssets.reduce((sum, asset) => sum + asset.sizeBytes, 0)) })}</span>
            <div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedCacheAssetIds(new Set())}>{t("settings:cacheClearSelection")}</Button>
              <ConfirmingDeleteButton
                disabled={cacheAction !== "" || !selectedCleanableCacheAssets.length}
                isBusy={cacheAction === "delete"}
                label={t("settings:cacheDeleteSelected")}
                confirmLabel={t("common:bulk.confirmDelete")}
                busyLabel={t("settings:cacheDeleting")}
                resetKey={`${selectedCacheAssetIds.size}-${selectedCleanableCacheAssets.length}`}
                cancelLabel={t("common:actions.cancel")}
                onDelete={() => deleteCacheAssets(selectedCleanableCacheAssets, "delete", true)}
              />
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
