import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownToLine, Download, Eraser, Images, Play, Square, Trash2, Upload } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { AppScrollArea } from "../../../components/AppScrollArea";
import { useNativeCanvasActions } from "../canvasActions";
import { NodeToolbar, Position, useEdges, useNodes, useReactFlow } from "@xyflow/react";
import { useShallow } from "zustand/react/shallow";
import type { NativeCanvasNodeData, BatchImageGeneratorItem } from "../nativeCanvas";
import { BatchNodeProgress } from "../batch/BatchNodeProgress";
import { ImageGeneratorParamPanel } from "./ImageGeneratorParamPanel";
import { AdditionalReferenceToggle } from "./AdditionalReferenceToggle";
import { collectAdditionalPromptInputs, collectAdditionalImageReferences, collectBatchTargetImages, collectImageGeneratorPrompts, collectImageGeneratorReferences } from "../generation/imageGenerationInputs";
import { ReferenceComparisonImageViewer } from "./ReferenceComparisonImageViewer";
import { useInfiniteCanvasSettings } from "../infiniteCanvasSettings";
import { generationStatusPresentation, generationStatusTone } from "../generation/generationStatusPresentation";
import { GenerationStatusDisplay } from "../generation/GenerationStatusDisplay";
import { useGenerationTaskCache } from "../generation/generationTaskCache";
import { GenerationMediaPreview } from "./GenerationMediaPreview";
import { AssetUploadPlaceholder } from "./AssetUploadPlaceholder";
import { ResultAssetCreateButton } from "./ResultAssetCreateButton";
import { aggregateBatchItems, downloadBatchItemsSequentially, isBatchGenerationReady, isBatchItemActive, resolveBatchItemResult } from "../batch/batchItemPresentation";
import { MAX_BATCH_NODE_ITEMS } from "../batch/batchNodeTypes";
import type { ImageViewerAction, ImageViewerNavigation } from "../../../lib/ImageViewer";
import type { ImageViewerActivity } from "../../../lib/ImageViewerSurface";

type BatchItemTask = ReturnType<typeof useGenerationTaskCache.getState>["tasksById"][string] | undefined;
type BatchItemTone = ReturnType<typeof generationStatusTone>;

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

function batchItemTone(item: BatchImageGeneratorItem, task: BatchItemTask): BatchItemTone {
  return generationStatusTone({
    task,
    failed: item.status === "failed",
    queued: item.status === "queued",
    running: item.status === "running",
    persistedError: item.error,
    resultAvailable: Boolean(resolveBatchItemResult(item, task).url),
    resultDownloaded: item.resultDownloadState === "downloaded",
    ready: Boolean(item.sourceUrl),
  });
}

export function BatchImageGeneratorNodeBody({ nodeId, data, paramPanelVisible }: { nodeId: string; data: NativeCanvasNodeData; paramPanelVisible: boolean }) {
  const { t } = useTranslation();
  const actions = useNativeCanvasActions();
  const { deleteElements } = useReactFlow();
  const canvasNodes = useNodes<import("../nativeCanvas").NativeCanvasNode>();
  const canvasEdges = useEdges<import("../nativeCanvas").NativeCanvasEdge>();
  const inputRef = useRef<HTMLInputElement>(null);
  const { settings, updateSettings } = useInfiniteCanvasSettings();
  const state = data.batchImageGenerator || { items: [], prompt: "" };
  const items = state.items || [];
  const [viewer, setViewer] = useState<BatchImageGeneratorItem | null>(null);
  const [viewerMode, setViewerMode] = useState<"source" | "result">("result");
  const [viewerReferenceIndex, setViewerReferenceIndex] = useState(0);
  const [timerNow, setTimerNow] = useState(Date.now());
  const [downloadBusyItemId, setDownloadBusyItemId] = useState("");
  const tasksById = useGenerationTaskCache(useShallow((cache) => Object.fromEntries(
    items.map((item) => [item.latestGenerationTaskId || item.id, item.latestGenerationTaskId ? cache.tasksById[item.latestGenerationTaskId] : undefined]),
  )));
  const additionalReferences = collectAdditionalImageReferences(nodeId, canvasNodes, canvasEdges, t("infiniteCanvas:additionalReference"));
  const additionalPrompts = collectAdditionalPromptInputs(nodeId, canvasNodes, canvasEdges, t("infiniteCanvas:additionalReference"));
  const connectedPrompts = collectImageGeneratorPrompts(nodeId, canvasNodes, canvasEdges, t("infiniteCanvas:prompt"));
  const hasAdditionalReferences = additionalReferences.length > 0 || additionalPrompts.length > 0;
  // 「传入目标」端口连进来的图：只用来一键传成卡片，不参与参考图。
  // 这个节点生成中每秒都会重渲染，组来源还要遍历子树，所以按节点/边缓存。
  const importTargets = useMemo(
    () => collectBatchTargetImages(nodeId, canvasNodes, canvasEdges),
    [canvasEdges, canvasNodes, nodeId],
  );

  useEffect(() => {
    if (state.prompt && !String(data.text || "").trim()) actions.patchNodeDataSilently(nodeId, { text: state.prompt });
  }, [actions, data.text, nodeId, state.prompt]);

  const patch = (next: typeof state) => actions.patchNodeData(nodeId, { batchImageGenerator: next });
  const setItemAdditionalReferences = (itemId: string, checked: boolean) => patch({ ...state, items: items.map((item) => item.id === itemId ? { ...item, useAdditionalReferences: checked } : item) });
  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const selectedFiles = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, Math.max(0, MAX_BATCH_NODE_ITEMS - items.length));
    if (!selectedFiles.length) return;

    const uploads = selectedFiles.map((file) => ({
      file,
      item: {
        id: crypto.randomUUID(),
        sourceFileName: file.name,
        sourceLoadState: "loading" as const,
        status: "pending" as const,
      },
    }));
    patch({ ...state, items: [...items, ...uploads.map(({ item }) => item)] });

    await Promise.all(uploads.map(async ({ file, item }) => {
      try {
        const sourceUrlPromise = readFileAsDataUrl(file);
        const storedPromise = window.easyTool?.importCanvasAssetFile?.({ file });
        const [sourceUrl, stored] = await Promise.all([sourceUrlPromise, storedPromise]);
        actions.patchBatchImageGeneratorItemSilently(nodeId, item.id, {
          sourceUrl: stored?.url || sourceUrl,
          sourceThumbUrl: stored?.thumbUrl || undefined,
          sourceLoadState: "ready",
          sourceLoadError: undefined,
        });
      } catch (error) {
        actions.patchBatchImageGeneratorItemSilently(nodeId, item.id, {
          sourceLoadState: "failed",
          sourceLoadError: error instanceof Error ? error.message : String(error),
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }));
  };

  const aggregate = aggregateBatchItems(items, tasksById);
  const completed = aggregate.completed;
  const running = aggregate.active > 0;
  const sourcesLoading = items.some((item) => item.sourceLoadState === "loading");
  const batchReady = !sourcesLoading && isBatchGenerationReady(items, String(data.text || state.prompt || ""), connectedPrompts.map((item) => item.text));

  const downloadAll = async () => {
    if (downloadBusyItemId) return;
    const downloadable = items.filter((item) => Boolean(resolveBatchItemResult(item, item.latestGenerationTaskId ? tasksById[item.latestGenerationTaskId] : undefined).url));
    if (!downloadable.length) return;
    setDownloadBusyItemId("all");
    await downloadBatchItemsSequentially(downloadable, async (item) => {
      const index = items.findIndex((candidate) => candidate.id === item.id);
      if (index >= 0) await actions.downloadNodeImage(nodeId, index);
    });
    setDownloadBusyItemId("");
  };

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const deleteItem = (item: BatchImageGeneratorItem) => {
    const task = item.latestGenerationTaskId ? tasksById[item.latestGenerationTaskId] : undefined;
    if (isBatchItemActive(item, task)) void actions.stopBatchImageGeneration(nodeId, item.id);
    patch({ ...state, items: items.filter((candidate) => candidate.id !== item.id) });
  };
  /** 清除全部卡片：正在跑的任务先停掉，免得卡片没了任务还在后台跑。 */
  const clearAllItems = () => {
    if (!items.length) return;
    items.forEach((item) => {
      const task = item.latestGenerationTaskId ? tasksById[item.latestGenerationTaskId] : undefined;
      if (isBatchItemActive(item, task)) void actions.stopBatchImageGeneration(nodeId, item.id);
    });
    patch({ ...state, items: [], taskReferenceOrder: 0 });
  };
  /**
   * 传入目标：把「传入目标」端口连进来的图按顺序传成卡片。
   * 已经在卡片里的（同一个素材地址）默认跳过；超过卡片上限的直接截断。
   */
  const importTargetImages = () => {
    if (!importTargets.length) return;
    const existingUrls = new Set(items.map((item) => String(item.sourceUrl || "")).filter(Boolean));
    const pending = importTargets.filter((target) => target.imageUrl && !existingUrls.has(target.imageUrl));
    const capacity = Math.max(0, MAX_BATCH_NODE_ITEMS - items.length);
    const accepted = pending.slice(0, capacity);
    if (!accepted.length) return;
    patch({
      ...state,
      items: [...items, ...accepted.map((target) => ({
        id: crypto.randomUUID(),
        sourceFileName: target.fileName || target.title || t("infiniteCanvas:batchImageItem"),
        sourceUrl: target.imageUrl,
        sourceThumbUrl: target.previewUrl || undefined,
        sourceLoadState: "ready" as const,
        status: "pending" as const,
      }))],
    });
  };
  const openViewer = (item: BatchImageGeneratorItem, mode: "source" | "result") => {
    setViewerMode(mode);
    setViewerReferenceIndex(0);
    setViewer(item);
  };
  const viewerItem = viewer ? items.find((item) => item.id === viewer.id) : undefined;
  const viewerTask = viewerItem?.latestGenerationTaskId ? tasksById[viewerItem.latestGenerationTaskId] : undefined;
  const viewerResult = resolveBatchItemResult(viewerItem, viewerTask);
  const viewerSrc = viewerItem ? (viewerMode === "source" ? viewerItem.sourceUrl || viewerResult.url : viewerResult.url || viewerItem.sourceUrl) : "";
  const viewerReferences = (() => {
    if (!viewerItem || viewerMode !== "result" || !viewerItem.sourceUrl) return [];
    const primaryReferences = collectImageGeneratorReferences(nodeId, canvasNodes, canvasEdges, t("infiniteCanvas:mainReference"));
    const taskReferenceOrder = Math.max(0, Math.min(primaryReferences.length, Math.round(Number(state.taskReferenceOrder || 0))));
    const orderedReferences = [...primaryReferences];
    orderedReferences.splice(taskReferenceOrder, 0, {
      edgeId: `batch-task-source:${viewerItem.id}`,
      nodeId,
      order: taskReferenceOrder,
      imageUrl: viewerItem.sourceUrl,
      previewUrl: viewerItem.sourceThumbUrl || "",
      title: t("infiniteCanvas:batchTaskTarget"),
    });
    if (viewerItem.useAdditionalReferences) orderedReferences.push(...additionalReferences);
    return orderedReferences
      .filter((reference, index, references) => references.findIndex((candidate) => candidate.imageUrl === reference.imageUrl) === index)
      .map((reference) => ({ id: reference.edgeId, src: reference.imageUrl, thumbnailSrc: reference.previewUrl, alt: reference.title || t("infiniteCanvas:mainReference") }));
  })();

  const viewerIndex = viewerItem ? items.findIndex((item) => item.id === viewerItem.id) : -1;
  const viewerNavigation: ImageViewerNavigation | undefined = items.length > 1 && viewerIndex >= 0 ? {
    index: viewerIndex,
    total: items.length,
    previousLabel: t("infiniteCanvas:previousImage"),
    nextLabel: t("infiniteCanvas:nextImage"),
    onPrevious: () => { const item = items[viewerIndex - 1]; if (item) setViewer(item); },
    onNext: () => { const item = items[viewerIndex + 1]; if (item) setViewer(item); },
  } : undefined;
  const viewerActivity: ImageViewerActivity | undefined = viewerItem && isBatchItemActive(viewerItem, viewerTask)
    ? { state: viewerItem.status === "queued" || viewerTask?.status === "queued" || viewerTask?.status === "preparing" || viewerTask?.status === "submitting" ? "queued" : "running", label: t("infiniteCanvas:generationInProgress") }
    : undefined;
  const viewerActions: ImageViewerAction[] = viewerItem && viewerMode === "result" ? [{
    id: "batch-rerun",
    label: viewerActivity ? t("infiniteCanvas:running") : t("infiniteCanvas:actionFissionRerunImage"),
    icon: "refresh",
    disabled: Boolean(viewerActivity) || !viewerItem.sourceUrl,
    onClick: () => void actions.runBatchImageGeneration(nodeId, viewerItem.id),
  }] : [];

  return (
    <>
      <NodeToolbar nodeId={nodeId} isVisible={paramPanelVisible} position={Position.Top} className="rf-native-node-toolbar">
        <Button type="button" variant="default" size="icon-sm" disabled={!running && !batchReady} aria-label={running ? t("infiniteCanvas:stopRun") : t("infiniteCanvas:run")} title={running ? t("infiniteCanvas:stopRun") : t("infiniteCanvas:run")} onClick={() => void (running ? actions.stopBatchImageGeneration(nodeId) : actions.runBatchImageGeneration(nodeId))}>{running ? <Square aria-hidden="true" fill="currentColor" /> : <Play aria-hidden="true" fill="currentColor" />}</Button>
        {/* 运行 | 下载 / 删除 */}
        <span className="rf-native-toolbar-divider" aria-hidden="true" />
        <Button type="button" variant="ghost" size="icon-sm" disabled={!completed || Boolean(downloadBusyItemId)} aria-label={t("infiniteCanvas:actionFissionDownloadAll")} title={t("infiniteCanvas:actionFissionDownloadAll")} onClick={() => void downloadAll()}><Download aria-hidden="true" /></Button>
        <Button type="button" variant="destructive" size="icon-sm" aria-label={t("common:actions.delete")} title={t("common:actions.delete")} onClick={() => void deleteElements({ nodes: [{ id: nodeId }] })}><Trash2 aria-hidden="true" /></Button>
      </NodeToolbar>
      <section className="rf-action-fission rf-batch-image-generator" data-generating={running} data-has-additional-references={hasAdditionalReferences || undefined}>
        <header className="rf-action-fission-header">
          {/* 有「传入目标」的入边时出现，一次把全部目标图传成卡片。 */}
          {importTargets.length && !actions.readOnly ? (
            <Button
              className="nodrag"
              size="sm"
              variant="default"
              disabled={items.length >= MAX_BATCH_NODE_ITEMS}
              aria-label={t("infiniteCanvas:batchImportTarget")}
              title={t("infiniteCanvas:batchImportTarget")}
              onClick={importTargetImages}
            >
              <ArrowDownToLine data-icon="inline-start" aria-hidden="true" />
              {t("infiniteCanvas:batchImportTarget")}
            </Button>
          ) : null}
          <BatchNodeProgress completed={completed} total={items.length} tone={batchReady ? aggregate.tone : "idle"} label={aggregate.failed ? `${completed}/${items.length} · ${aggregate.failed}` : `${completed}/${items.length}`} />
          <Button className="nodrag" size="sm" variant="ghost" onClick={() => inputRef.current?.click()}><Upload data-icon="inline-start" />{t("infiniteCanvas:batchUploadImages")}</Button>
          <Button
            className="nodrag"
            size="sm"
            variant="ghost"
            disabled={!items.length}
            aria-label={t("infiniteCanvas:batchClearAll")}
            title={t("infiniteCanvas:batchClearAll")}
            onClick={clearAllItems}
          >
            <Eraser data-icon="inline-start" aria-hidden="true" />
            {t("infiniteCanvas:batchClearAll")}
          </Button>
          <input ref={inputRef} hidden type="file" accept="image/*" multiple onChange={(e) => { void addFiles(e.target.files); e.currentTarget.value = ""; }} />
        </header>
        <AppScrollArea className="rf-action-fission-scroll nowheel" viewportClassName="rf-action-fission-scroll-viewport" scrollBarClassName="nodrag">
          {items.length ? <div className="rf-action-fission-grid">
          {items.map((item: BatchImageGeneratorItem, index) => {
            const task = item.latestGenerationTaskId ? tasksById[item.latestGenerationTaskId] : undefined;
            const sourceLoading = item.sourceLoadState === "loading";
            const tone = batchItemTone(item, task);
            const result = resolveBatchItemResult(item, task);
            const itemRunning = tone === "queued" || tone === "running";
            const showOverlay = itemRunning || tone === "error";
            const presentation = generationStatusPresentation({ task, failed: item.status === "failed", queued: item.status === "queued", running: item.status === "running", persistedError: item.error, resultAvailable: Boolean(result.url), resultDownloaded: item.resultDownloadState === "downloaded", ready: Boolean(item.sourceUrl) && batchReady }, t, timerNow);
            const canDownload = Boolean(result.url) && !itemRunning && tone !== "error";
            const isPendingDownload = canDownload && item.resultDownloadState !== "downloaded";
            const openResult = (event: React.MouseEvent<HTMLDivElement>) => { event.stopPropagation(); if (result.url) openViewer(item, "result"); };
            const openSource = (event: React.MouseEvent<HTMLDivElement>) => { event.stopPropagation(); if (item.sourceUrl) openViewer(item, "source"); };
            const openResultFromKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); if (result.url) openViewer(item, "result"); } };
            const openSourceFromKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); if (item.sourceUrl) openViewer(item, "source"); } };
            const downloadItem = () => {
              if (!canDownload || downloadBusyItemId) return;
              setDownloadBusyItemId(item.id);
              void actions.downloadNodeImage(nodeId, index).catch(() => undefined).finally(() => setDownloadBusyItemId(""));
            };
            const resultPreview = (
              <div className={`rf-action-fission-result-preview nodrag nopan${itemRunning ? " is-generating" : ""}${showOverlay && tone === "error" ? " has-generation-error" : ""}`}>
                {sourceLoading
                  ? <AssetUploadPlaceholder className="rf-asset-upload-result-placeholder" label={t("infiniteCanvas:assetLoading")} />
                  : <GenerationMediaPreview src={result.url} thumbSrc={result.thumbUrl} alt={t("infiniteCanvas:actionFissionResultPreview")} onClick={openResult} onKeyDown={openResultFromKeyboard} />}
                {canDownload ? <Button className={`rf-action-fission-download${isPendingDownload ? " is-pending" : ""}`} type="button" variant="ghost" size="icon-xs" disabled={downloadBusyItemId === item.id} aria-label={t(isPendingDownload ? "infiniteCanvas:imagePendingDownload" : "infiniteCanvas:imageDownloaded")} title={t(isPendingDownload ? "infiniteCanvas:imagePendingDownload" : "infiniteCanvas:imageDownloaded")} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); downloadItem(); }}><Download aria-hidden="true" /></Button> : null}
                {!sourceLoading && showOverlay ? <GenerationStatusDisplay presentation={presentation} mode="overlay" /> : null}
                {!sourceLoading && !showOverlay ? <GenerationStatusDisplay presentation={presentation} mode="inline" className="rf-generation-status--result" /> : null}
              </div>
            );
            const sourcePreview = sourceLoading
              ? <AssetUploadPlaceholder className="rf-action-fission-action-preview rf-asset-upload-thumbnail-placeholder nodrag nopan" label={t("infiniteCanvas:assetLoading")} />
              : <GenerationMediaPreview className="rf-action-fission-action-preview nodrag nopan" src={item.sourceUrl} thumbSrc={item.sourceThumbUrl} alt={item.sourceFileName || `${t("infiniteCanvas:batchImageItem")} ${index + 1}`} onClick={openSource} onKeyDown={openSourceFromKeyboard} />;
            return <article className="rf-action-fission-grid-card" data-index={String(index + 1).padStart(2, "0")} data-source-loading={sourceLoading || undefined} data-source-ready={item.sourceLoadState === "ready" || undefined} key={item.id}>
              <ResultAssetCreateButton
                index={index + 1}
                disabled={actions.readOnly || !canDownload}
                onCreate={(clientPoint) => actions.createAssetNodeFromResult({
                  sourceNodeId: nodeId,
                  sourceKey: item.id,
                  clientPoint,
                  url: result.url,
                  thumbUrl: result.thumbUrl,
                  fileName: result.fileName,
                  width: result.width,
                  height: result.height,
                })}
              />
              {resultPreview}
              <div className="rf-action-fission-action-stack">{hasAdditionalReferences ? <AdditionalReferenceToggle checked={Boolean(item.useAdditionalReferences)} disabled={itemRunning} onCheckedChange={(checked) => setItemAdditionalReferences(item.id, checked)} /> : null}{sourcePreview}</div>
              <div className="rf-action-fission-row-summary"><strong>{item.sourceFileName || `${t("infiniteCanvas:batchImageItem")} ${index + 1}`}</strong></div>
              <div className="rf-action-fission-row-actions nodrag"><Button type="button" variant="ghost" size="icon-xs" disabled={!itemRunning && (!batchReady || !item.sourceUrl)} aria-label={itemRunning ? t("infiniteCanvas:stopRun") : t("infiniteCanvas:run")} onClick={() => void (itemRunning ? actions.stopBatchImageGeneration(nodeId, item.id) : actions.runBatchImageGeneration(nodeId, item.id))}>{itemRunning ? <Square aria-hidden="true" fill="currentColor" /> : <Play aria-hidden="true" />}</Button><Button type="button" variant="ghost" size="icon-xs" aria-label={t("common:actions.delete")} onClick={() => deleteItem(item)}><Trash2 aria-hidden="true" /></Button></div>
            </article>;
          })}
          </div> : <div className="rf-action-fission-empty rf-batch-image-generator-empty" role="status">
            <Images aria-hidden="true" />
            <span>{t("infiniteCanvas:batchEmptyPrompt")}</span>
          </div>}
        </AppScrollArea>
      </section>
      <ImageGeneratorParamPanel nodeId={nodeId} data={{ ...data, text: data.text || state.prompt }} visible={paramPanelVisible} showPrompt showImageCount={false} runDisabled={!batchReady} taskRunningOverride={running} onRun={() => actions.runBatchImageGeneration(nodeId)} onStop={() => actions.stopBatchImageGeneration(nodeId)} beforeRunControl={<Button type="button" variant="ghost" size="icon-sm" disabled={!completed || Boolean(downloadBusyItemId)} aria-label={t("infiniteCanvas:actionFissionDownloadAll")} title={t("infiniteCanvas:actionFissionDownloadAll")} onClick={() => void downloadAll()}><Download /></Button>} />
      {viewerSrc ? <ReferenceComparisonImageViewer src={viewerSrc} alt={viewerMode === "source" ? viewerItem?.sourceFileName || t("infiniteCanvas:batchImageItem") : viewerItem?.sourceFileName || t("infiniteCanvas:actionFissionResultPreview")} ariaLabel={t("infiniteCanvas:viewLargeImage")} onClose={() => setViewer(null)} actions={viewerActions} activity={viewerActivity} navigation={viewerNavigation} references={viewerReferences} referenceIndex={viewerReferenceIndex} onReferenceIndexChange={setViewerReferenceIndex} comparisonEnabled={viewerMode === "result" && settings.referenceComparisonViewer.referenceComparisonEnabled} comparisonLabel={t("infiniteCanvas:referenceComparison")} onComparisonEnabledChange={(enabled) => updateSettings((current) => ({ ...current, referenceComparisonViewer: { ...current.referenceComparisonViewer, referenceComparisonEnabled: enabled } }))} referencePanelPercent={settings.referenceComparisonViewer.referencePanelPercent} onReferencePanelPercentChange={(percent) => updateSettings((current) => ({ ...current, referenceComparisonViewer: { ...current.referenceComparisonViewer, referencePanelPercent: Math.max(20, Math.min(80, Math.round(percent))) } }))} /> : null}
    </>
  );
}
