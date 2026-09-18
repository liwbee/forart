import { Handle, NodeToolbar, Position, useReactFlow, useStore, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import { ImageAiFillIcon } from "./canvasNodeIcons";
import { ArrowLeft, Check, ChevronUp, CircleAlert, Copy, Crop, Download, Images, LoaderCircle, Maximize2, Play, SlidersHorizontal, Square, Trash2, Upload, X } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AppSelect } from "../../../components/AppSelect";
import { ImageWithFallback } from "../../../components/ImageWithFallback";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Textarea } from "../../../components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { copyText } from "../../../components/ErrorCopyLine";
import { ImageViewer } from "../../../lib/ImageViewer";
import { resolveLibraryImageUrl } from "../../../lib/libraryImageActions";
import { cn } from "../../../lib/utils";
import { isCanvasAssetFile, readImageFileAsDataUrl, readMediaFileDimensions, useNativeCanvasActions, type CanvasImageCropRect } from "../canvasActions";
import { useNativeCanvasInteractionStore } from "../canvasInteractionStore";
import {
  nativeCanvasNodePrimaryImage,
  nativeCanvasNodeTaskId,
  NATIVE_CANVAS_NODE_DEFINITIONS,
  type NativeCanvasEdge,
  type NativeCanvasNode as NativeCanvasNodeType,
} from "../nativeCanvas";
import { NativeNodeResizeControl } from "./NativeNodeResizeControl";
import { ImageGeneratorParamPanel } from "./ImageGeneratorParamPanel";
import { ActionFissionNodeBody } from "./ActionFissionNodeBody";
import { BatchImageGeneratorNodeBody } from "./BatchImageGeneratorNodeBody";
import { AssetUploadPlaceholder } from "./AssetUploadPlaceholder";
import { canvasPreviewSourceUrl } from "../canvasThumbnails";
import { formatGenerationDuration, generationStatusMessage } from "../generation/generationStatus";
import {
  clearNodeGenerationRuntimeErrors,
  isImageNodeLaunching,
  useGenerationRuntimeStore,
} from "../generation/generationRuntimeStore";
import { isGenerationTaskActive, useGenerationTaskCache } from "../generation/generationTaskCache";
import { ImageNodeCropEditor, type ImageCropAspect } from "./ImageNodeCropEditor";
import { ImageGeneratorImageViewer } from "./ImageGeneratorImageViewer";
import { NativeNodeCaption } from "./NativeNodeCaption";
import { VideoAssetBody } from "./VideoAssetBody";
import { AnnotationNodeBody } from "./AnnotationNodeBody";
import { AnnotationNodeToolbarControls } from "./AnnotationNodeToolbarControls";
import { SmartReverseNodeBody } from "./ImageReverseNodeBody";
import { SmartReverseParamPanel } from "./ImageReverseParamPanel";
import { useSmartReverseRuntimeStore } from "../generation/imageReverseRuntimeStore";
import { useCanvasAgent } from "../../canvas-agent";
import { EXTENSION_SETTINGS_CHANGED_EVENT, hasLoadedExtensionSettings, loadExtensionSettings, readExtensionSettings } from "../../settings/extensionSettings";

function GenerationErrorStatus({ message }: { message: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const iconRef = useRef<SVGSVGElement | null>(null);
  const textRef = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    const updateLineClamp = () => {
      const containerStyle = window.getComputedStyle(container);
      const textStyle = window.getComputedStyle(text);
      const padding = parseFloat(containerStyle.paddingTop) + parseFloat(containerStyle.paddingBottom);
      const gap = parseFloat(containerStyle.rowGap || containerStyle.gap) || 0;
      const fixedHeight = iconRef.current?.getBoundingClientRect().height || 0;
      const lineHeight = parseFloat(textStyle.lineHeight) || 17;
      const availableHeight = container.clientHeight - padding - fixedHeight - gap;
      text.style.setProperty("-webkit-line-clamp", String(Math.max(1, Math.floor(availableHeight / lineHeight))));
    };

    updateLineClamp();
    const observer = new ResizeObserver(updateLineClamp);
    observer.observe(container);
    return () => observer.disconnect();
  }, [message]);

  return (
    <div ref={containerRef} className="rf-native-generation-status is-error" role="alert" aria-live="polite">
      <CircleAlert ref={iconRef} aria-hidden="true" />
      <span ref={textRef}>{message}</span>
    </div>
  );
}

export const NativeCanvasNode = memo(function NativeCanvasNode({ id, data, selected, dragging }: NodeProps<NativeCanvasNodeType>) {
  const { t } = useTranslation();
  const { deleteElements, getNode, setNodes } = useReactFlow<NativeCanvasNodeType, NativeCanvasEdge>();
  const updateNodeInternals = useUpdateNodeInternals();
  const zoom = useStore((state) => state.transform[2]);
  const actions = useNativeCanvasActions();
  const nodeFrameRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const promptHistoryGestureActiveRef = useRef(false);
  const isPromptEditing = useNativeCanvasInteractionStore((state) => state.editingNodeId === id);
  const isNodeToolbarActive = useNativeCanvasInteractionStore((state) => state.toolbarNodeId === id);
  const beginNodeEditing = useNativeCanvasInteractionStore((state) => state.beginNodeEditing);
  const endNodeEditing = useNativeCanvasInteractionStore((state) => state.endNodeEditing);
  const definition = NATIVE_CANVAS_NODE_DEFINITIONS[data.kind];
  const nodeTypeLabel = t(`infiniteCanvas:${definition.labelKey}`);
  const displayLabel = data.kind === "assetLoader" && data.assetUrl && data.label
    ? data.label
    : nodeTypeLabel;
  const Icon = definition.icon;
  const isImageNode = data.kind === "assetLoader" || data.kind === "imageGenerator";
  const isVideoAsset = data.kind === "assetLoader" && data.assetType === "video";
  const isPromptNode = data.kind === "prompt";
  const isSmartReverseNode = data.kind === "smartReverse";
  const canvasAgent = useCanvasAgent();
  const smartReverseRunFromAgent = isSmartReverseNode && Object.values(canvasAgent.runs).some((run) => run.nodeId === id && run.task === "smart-reverse" && run.status === "running");
  const smartReverseRunning = useSmartReverseRuntimeStore((state) => Boolean(state.runningByNode[id])) || smartReverseRunFromAgent;
  const isAnnotationNode = data.kind === "annotation";
  const isActionFissionNode = data.kind === "actionFission";
  const isBatchImageGeneratorNode = data.kind === "batchImageGenerator";
  const isBatchLikeNode = isActionFissionNode || isBatchImageGeneratorNode;
  const captionTitle = String(data.label || "").trim() || nodeTypeLabel;
  const isLaunching = useGenerationRuntimeStore((state) => isImageNodeLaunching(state.launchingKeys, id));
  const taskId = nativeCanvasNodeTaskId(data);
  const activeGenerationTask = useGenerationTaskCache((state) => taskId ? state.tasksById[taskId] : undefined);
  const runtimeError = useGenerationRuntimeStore((state) => Object.entries(state.errorsByKey)
    .find(([key]) => key.endsWith(`:node:${id}`))?.[1] || "");
  const taskDismissed = useGenerationRuntimeStore((state) => taskId ? state.dismissedTaskIds.has(taskId) : false);
  const activeGenerationError = runtimeError
    || (!taskDismissed && activeGenerationTask?.status === "failed" ? String(activeGenerationTask.errorMessage || "") : "");
  const isImageGenerationTaskRunning = data.kind === "imageGenerator" && isGenerationTaskActive(activeGenerationTask);
  const isGenerating = data.kind === "imageGenerator" && (isLaunching || isImageGenerationTaskRunning);
  const hasGenerationError = data.kind === "imageGenerator" && !isGenerating && Boolean(activeGenerationError);
  const generationMessage = isGenerating
    ? isLaunching
      ? t("infiniteCanvas:generationPreparing")
      : generationStatusMessage(activeGenerationTask, t) || t("infiniteCanvas:running")
    : hasGenerationError ? activeGenerationError : "";
  const [timerNow, setTimerNow] = useState(Date.now());
  const [isDownloadBusy, setIsDownloadBusy] = useState(false);
  const [isBackgroundRemovalBusy, setIsBackgroundRemovalBusy] = useState(false);
  const [backgroundRemovalEnabled, setBackgroundRemovalEnabled] = useState(() => readExtensionSettings().backgroundRemovalEnabled);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [isCropping, setIsCropping] = useState(false);
  // 进入裁剪默认用自由比例：先让用户随便框，需要固定比例时再切换。
  const [cropAspect, setCropAspect] = useState<ImageCropAspect>("free");
  const [cropSelection, setCropSelection] = useState<CanvasImageCropRect | null>(null);
  const [isCropBusy, setIsCropBusy] = useState(false);
  const [referenceHintsVisible, setReferenceHintsVisible] = useState(false);
  useEffect(() => {
    if (!isBatchLikeNode) return;
    // The handles are revealed by `.react-flow__node:hover`, so their hints follow
    // the same boundary: the whole node element, caption, dots and body included.
    const nodeElement = nodeFrameRef.current?.closest(".react-flow__node");
    if (!nodeElement) return;
    const showHints = () => setReferenceHintsVisible(true);
    const hideHints = () => setReferenceHintsVisible(false);
    nodeElement.addEventListener("pointerenter", showHints);
    nodeElement.addEventListener("pointerleave", hideHints);
    return () => {
      nodeElement.removeEventListener("pointerenter", showHints);
      nodeElement.removeEventListener("pointerleave", hideHints);
      setReferenceHintsVisible(false);
    };
  }, [isBatchLikeNode]);
  useEffect(() => {
    const syncExtensionSettings = () => setBackgroundRemovalEnabled(readExtensionSettings().backgroundRemovalEnabled);
    window.addEventListener(EXTENSION_SETTINGS_CHANGED_EVENT, syncExtensionSettings);
    if (!hasLoadedExtensionSettings()) void loadExtensionSettings().then(syncExtensionSettings).catch(() => undefined);
    return () => window.removeEventListener(EXTENSION_SETTINGS_CHANGED_EVENT, syncExtensionSettings);
  }, []);
  const generationStartedAt = Number(activeGenerationTask?.runningAt || activeGenerationTask?.startedAt || 0);
  const elapsedText = formatGenerationDuration(generationStartedAt ? timerNow - generationStartedAt : 0);
  const imageWidth = Math.round(Number(data.assetNaturalWidth || data.imageNaturalWidth || 0));
  const imageHeight = Math.round(Number(data.assetNaturalHeight || data.imageNaturalHeight || 0));
  const imageResolution = imageWidth > 0 && imageHeight > 0 ? `${imageWidth} x ${imageHeight}` : "";
  const generatedImages = data.kind === "imageGenerator"
    ? (data.generatedImages || []).filter((result) => result.localUrl || result.url)
    : [];
  const primaryImage = nativeCanvasNodePrimaryImage(data);
  const primaryAssetUrl = data.kind === "assetLoader" ? String(data.assetUrl || "") : "";
  const primaryImageUrl = String(primaryImage?.localUrl || primaryImage?.url || "");
  const showImageGeneratorEmptyIcon = data.kind === "imageGenerator"
    && !primaryImageUrl
    && !isGenerating
    && !generationMessage;
  const showGeneratorDownload = data.kind === "imageGenerator" && Boolean(primaryImageUrl) && !isGenerating && !hasGenerationError;
  const isPendingDownload = showGeneratorDownload && primaryImage?.downloadState !== "downloaded";
  const canUseImageActions = isImageNode && Boolean(primaryImageUrl) && !isGenerating && !hasGenerationError;
  const toolbarVisible = selected && isNodeToolbarActive && !dragging;
  const toolbarOffset = zoom * (isAnnotationNode ? 12 : 36);
  const annotationFrameStyle = isAnnotationNode
    ? { "--rf-annotation-outline-width": `${(1 / Math.max(zoom, 0.01)).toFixed(2)}px` } as CSSProperties
    : undefined;
  const resolvedImageUrl = primaryImageUrl ? resolveLibraryImageUrl(primaryImageUrl) : "";
  const previewSourceUrl = canvasPreviewSourceUrl(primaryImageUrl, primaryImage?.thumbUrl);
  const resolvedPreviewUrl = previewSourceUrl ? resolveLibraryImageUrl(previewSourceUrl) : "";
  const resolvedPreviewFallbackUrl = resolvedImageUrl;
  const isAssetLoading = data.kind === "assetLoader" && data.assetLoadState === "processing";
  const assetLoadError = data.kind === "assetLoader" && data.assetLoadState === "error"
    ? String(data.assetLoadError || "")
    : "";
  const hasMultipleGeneratedImages = generatedImages.length > 1;
  const isMultiImageExpanded = hasMultipleGeneratedImages
    && Boolean(data.multiImageExpanded)
    && !isGenerating
    && !hasGenerationError;
  const generatedViewerImages = generatedImages.length
    ? generatedImages
      .map((result) => String(result.localUrl || result.url || ""))
      .filter(Boolean)
      .map(resolveLibraryImageUrl)
    : [];
  const viewerImages = generatedViewerImages.length ? generatedViewerImages : resolvedImageUrl ? [resolvedImageUrl] : [];
  const viewerSrc = viewerImages[Math.min(viewerIndex, Math.max(0, viewerImages.length - 1))] || "";
  const viewerNavigation = viewerImages.length > 1 ? {
    index: viewerIndex,
    total: viewerImages.length,
    previousLabel: t("infiniteCanvas:previousImage"),
    nextLabel: t("infiniteCanvas:nextImage"),
    onPrevious: () => setViewerIndex((current) => Math.max(0, current - 1)),
    onNext: () => setViewerIndex((current) => Math.min(viewerImages.length - 1, current + 1)),
  } : undefined;

  const downloadImage = () => {
    if (isDownloadBusy) return;
    setIsDownloadBusy(true);
    void actions.downloadNodeImage(id, 0).catch(() => undefined).finally(() => setIsDownloadBusy(false));
  };

  const cancelCrop = () => {
    if (isCropBusy) return;
    setIsCropping(false);
    setCropSelection(null);
  };

  const confirmCrop = (mode: "newNode" | "overwrite") => {
    if (!cropSelection || isCropBusy) return;
    setIsCropBusy(true);
    void actions.cropNodeImage(id, cropSelection, { mode })
      .then(() => {
        setIsCropping(false);
        setCropSelection(null);
        window.requestAnimationFrame(() => updateNodeInternals(id));
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(t("infiniteCanvas:imageCropFailed", { message }));
      })
      .finally(() => setIsCropBusy(false));
  };

  const setMultiImageExpanded = useCallback((expanded: boolean) => {
    if (!hasMultipleGeneratedImages) return;
    const node = getNode(id);
    const collapsedSize = data.multiImageCollapsedSize || {
      width: Math.max(1, Number(node?.style?.width || node?.measured?.width || node?.width || 0)),
      height: Math.max(1, Number(node?.style?.height || node?.measured?.height || node?.height || 0)),
    };
    actions.patchNodeDataSilently(id, {
      multiImageExpanded: expanded,
      multiImageCollapsedSize: collapsedSize,
    });
  }, [actions, data.multiImageCollapsedSize, getNode, hasMultipleGeneratedImages, id]);

  useEffect(() => {
    if (!isPromptEditing) return;
    promptInputRef.current?.focus();
    promptInputRef.current?.select();
  }, [isPromptEditing]);

  const beginPromptHistoryGesture = useCallback(() => {
    if (promptHistoryGestureActiveRef.current) return;
    promptHistoryGestureActiveRef.current = true;
    actions.beginHistoryGesture();
  }, [actions]);

  const endPromptHistoryGesture = useCallback(() => {
    if (!promptHistoryGestureActiveRef.current) return;
    promptHistoryGestureActiveRef.current = false;
    actions.endHistoryGesture();
  }, [actions]);

  useEffect(() => () => endPromptHistoryGesture(), [endPromptHistoryGesture]);

  useEffect(() => {
    if (!isGenerating || isLaunching) return;
    setTimerNow(Date.now());
    const interval = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isGenerating, isLaunching]);

  useEffect(() => {
    if (data.kind !== "imageGenerator" || !primaryImage || (imageWidth > 0 && imageHeight > 0)) return;
    const embeddedWidth = Math.round(Number(primaryImage.width || 0));
    const embeddedHeight = Math.round(Number(primaryImage.height || 0));
    if (embeddedWidth > 0 && embeddedHeight > 0) {
      actions.patchNodeDataSilently(id, {
        imageNaturalWidth: embeddedWidth,
        imageNaturalHeight: embeddedHeight,
      });
      return;
    }
    if (!resolvedImageUrl) return;

    let active = true;
    const image = new window.Image();
    image.onload = () => {
      if (!active || !image.naturalWidth || !image.naturalHeight) return;
      actions.patchNodeDataSilently(id, {
        imageNaturalWidth: image.naturalWidth,
        imageNaturalHeight: image.naturalHeight,
      });
    };
    image.src = resolvedImageUrl;
    return () => {
      active = false;
      image.onload = null;
    };
  }, [actions, data.kind, id, imageHeight, imageWidth, primaryImage, resolvedImageUrl]);

  useLayoutEffect(() => {
    if (data.kind !== "imageGenerator" || !hasMultipleGeneratedImages) return;
    const node = getNode(id);
    const measuredWidth = Math.max(1, Number(node?.style?.width || node?.measured?.width || node?.width || 0));
    const measuredHeight = Math.max(1, Number(node?.style?.height || node?.measured?.height || node?.height || 0));
    const collapsedSize = data.multiImageCollapsedSize || { width: measuredWidth, height: measuredHeight };
    const rows = generatedImages.length > 2 ? 2 : 1;
    const gap = 8;
    const targetWidth = isMultiImageExpanded ? collapsedSize.width * 2 + gap : collapsedSize.width;
    const targetHeight = isMultiImageExpanded ? collapsedSize.height * rows + gap * (rows - 1) : collapsedSize.height;
    setNodes((current) => current.map((item) => {
      if (item.id !== id) return item;
      const currentWidth = Number(item.style?.width || item.measured?.width || 0);
      const currentHeight = Number(item.style?.height || item.measured?.height || 0);
      if (Math.abs(currentWidth - targetWidth) < 0.5 && Math.abs(currentHeight - targetHeight) < 0.5) return item;
      return { ...item, style: { ...item.style, width: targetWidth, height: targetHeight } };
    }));
    const frame = window.requestAnimationFrame(() => updateNodeInternals(id));
    return () => window.cancelAnimationFrame(frame);
  }, [
    data.kind,
    data.multiImageCollapsedSize,
    generatedImages.length,
    getNode,
    hasMultipleGeneratedImages,
    id,
    isMultiImageExpanded,
    setNodes,
    updateNodeInternals,
  ]);

  useEffect(() => {
    if (!isMultiImageExpanded) return;
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (nodeFrameRef.current?.contains(event.target as globalThis.Node)) return;
      setMultiImageExpanded(false);
    };
    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  }, [isMultiImageExpanded, setMultiImageExpanded]);

  useEffect(() => {
    if (selected && isNodeToolbarActive) return;
    setIsCropping(false);
    setCropSelection(null);
  }, [isNodeToolbarActive, selected]);

  const removeBackground = useCallback(async () => {
    if (!backgroundRemovalEnabled || data.kind !== "assetLoader" || data.assetType !== "image" || !data.assetUrl) return;
    const tool = window.easyTool;
    if (!tool) return;
    setIsBackgroundRemovalBusy(true);
    try {
      const source = await tool.saveCanvasAsset({ url: resolveLibraryImageUrl(String(data.assetUrl)), defaultName: String(data.assetFileName || "image.png"), kind: "input" });
      if (!source.filePath) throw new Error(t("infiniteCanvas:backgroundRemovalFileMissing"));
      const bytes = await tool.removeImageBackground({ filePath: source.filePath });
      let binary = ""; for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
      const saved = await tool.saveCanvasAsset({ dataUrl: `data:image/png;base64,${btoa(binary)}`, defaultName: `${String(data.label || "image")}-matting.png`, kind: "output" });
      actions.createDerivedAssetNode(id, saved, {
        kind: "matting",
        label: `${String(data.label || t("infiniteCanvas:assetNode"))}-${t("infiniteCanvas:backgroundRemovalAction")}`,
      });
      toast.success(t("infiniteCanvas:backgroundRemovalCompleted"));
    } catch (error) {
      toast.error(t("infiniteCanvas:backgroundRemovalFailed", { message: String(error instanceof Error ? error.message : error) }));
    }
    finally { setIsBackgroundRemovalBusy(false); }
  }, [actions, backgroundRemovalEnabled, data, id, t]);

  // 工具栏按功能分组：主操作（运行 / 素材导入） | 图像处理（抠图 / 裁剪 / 图像调节） | 结果（查看 / 下载 / 删除）。
  // 相邻分组之间画一条竖分割线，避免十来个图标按钮混在一起看不出归属。
  const hasPrimaryToolbarActions = (data.kind === "assetLoader" || data.kind === "imageGenerator" || data.kind === "smartReverse") && !isCropping;
  const hasImageEditingToolbarActions = !isCropping && (
    (data.kind === "assetLoader" && Boolean(primaryImageUrl))
    || (canUseImageActions && !actions.readOnly)
  );

  return (
    <>
      {!isAnnotationNode ? (
        <NativeNodeCaption
          icon={Icon}
          title={captionTitle}
          editable
          renameLabel={t("common:actions.rename")}
          onRename={(label) => actions.patchNodeData(id, { label })}
        />
      ) : null}

      {toolbarVisible && !isActionFissionNode && !isBatchImageGeneratorNode ? (
        <NodeToolbar nodeId={id} position={Position.Top} offset={toolbarOffset} className="rf-native-node-toolbar">
          {isAnnotationNode ? (
            <AnnotationNodeToolbarControls nodeId={id} style={data.annotationStyle} />
          ) : isCropping ? (
            <>
              <AppSelect
                className="rf-native-image-crop-aspect nodrag nopan nowheel"
                value={cropAspect}
                size="sm"
                menuPlacement="top"
                ariaLabel={t("infiniteCanvas:imageCropAspect")}
                disabled={isCropBusy}
                options={[
                  { value: "original", label: t("infiniteCanvas:imageCropAspectOriginal") },
                  { value: "free", label: t("infiniteCanvas:imageCropAspectFree") },
                  { value: "1:1", label: "1:1" },
                  { value: "2:3", label: "2:3" },
                  { value: "3:2", label: "3:2" },
                  { value: "3:4", label: "3:4" },
                  { value: "4:3", label: "4:3" },
                  { value: "16:9", label: "16:9" },
                  { value: "9:16", label: "9:16" },
                ]}
                onChange={(value) => setCropAspect(value as ImageCropAspect)}
              />
              {/* 应用裁剪：和图像调节一样，交给用户决定是覆盖原图还是新建节点。 */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="default"
                    size="icon-sm"
                    disabled={!cropSelection || isCropBusy}
                    aria-label={t("infiniteCanvas:imageCropApply")}
                    title={t("infiniteCanvas:imageCropApply")}
                  >
                    {isCropBusy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" side="top">
                  <DropdownMenuItem onSelect={() => confirmCrop("overwrite")}>
                    {t("infiniteCanvas:imageAdjustApplyOverwrite")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => confirmCrop("newNode")}>
                    {t("infiniteCanvas:imageAdjustApplyNewNode")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={isCropBusy}
                aria-label={t("common:actions.cancel")}
                title={t("common:actions.cancel")}
                onClick={cancelCrop}
              >
                <X aria-hidden="true" />
              </Button>
            </>
          ) : (
            <>
              {/* 主操作：运行 / 素材导入 */}
              {data.kind === "assetLoader" ? (
                <>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("common:actions.uploadAsset")} title={t("common:actions.uploadAsset")} onClick={() => fileInputRef.current?.click()}>
                    <Upload aria-hidden="true" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("infiniteCanvas:importFromLibrary")} title={t("infiniteCanvas:importFromLibrary")} onClick={() => actions.openLibraryForNode(id)}>
                    <Images aria-hidden="true" />
                  </Button>
                </>
              ) : null}
              {data.kind === "imageGenerator" ? (
                <Button
                  type="button"
                  variant="default"
                  size="icon-sm"
                  disabled={isLaunching}
                  aria-label={t(isImageGenerationTaskRunning ? "infiniteCanvas:stopRun" : "infiniteCanvas:run")}
                  title={t(isImageGenerationTaskRunning ? "infiniteCanvas:stopRun" : "infiniteCanvas:run")}
                  onClick={() => void (isImageGenerationTaskRunning
                    ? actions.stopImageGeneration(id)
                    : actions.runImageGeneration(id))}
                >
                  {isLaunching
                    ? <LoaderCircle className="animate-spin" aria-hidden="true" />
                    : isImageGenerationTaskRunning
                      ? <Square aria-hidden="true" fill="currentColor" />
                      : <Play aria-hidden="true" fill="currentColor" />}
                </Button>
              ) : null}
              {data.kind === "smartReverse" ? (
                <Button
                  type="button"
                  variant="default"
                  size="icon-sm"
                  aria-label={t(smartReverseRunning ? "infiniteCanvas:stopRun" : "infiniteCanvas:run")}
                  title={t(smartReverseRunning ? "infiniteCanvas:stopRun" : "infiniteCanvas:run")}
                  onClick={() => smartReverseRunning
                    ? useSmartReverseRuntimeStore.getState().stop(id)
                    : useSmartReverseRuntimeStore.getState().run(id)}
                >
                  {smartReverseRunning ? <Square aria-hidden="true" fill="currentColor" /> : <Play aria-hidden="true" fill="currentColor" />}
                </Button>
              ) : null}

              {hasPrimaryToolbarActions ? <span className="rf-native-toolbar-divider" aria-hidden="true" /> : null}

              {/* 图像处理：抠图 / 裁剪 / 图像调节 */}
              {backgroundRemovalEnabled && data.kind === "assetLoader" && primaryImageUrl ? (
                <Button type="button" variant="ghost" size="icon-sm" disabled={isBackgroundRemovalBusy} aria-label={t("infiniteCanvas:backgroundRemovalAction")} title={t("infiniteCanvas:backgroundRemovalAction")} onClick={() => void removeBackground()}>
                  {isBackgroundRemovalBusy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <ImageAiFillIcon aria-hidden="true" />}
                </Button>
              ) : null}
              {data.kind === "assetLoader" && primaryImageUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("infiniteCanvas:cropImage")}
                  title={t("infiniteCanvas:cropImage")}
                  onClick={() => {
                    setCropAspect("free");
                    setCropSelection(null);
                    setIsCropping(true);
                  }}
                >
                  <Crop aria-hidden="true" />
                </Button>
              ) : null}
              {canUseImageActions && !actions.readOnly ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("infiniteCanvas:imageAdjustAction")}
                  title={t("infiniteCanvas:imageAdjustAction")}
                  onClick={() => actions.openImageAdjustDialog(id, viewerIndex)}
                >
                  <SlidersHorizontal aria-hidden="true" />
                </Button>
              ) : null}

              {hasImageEditingToolbarActions ? <span className="rf-native-toolbar-divider" aria-hidden="true" /> : null}

              {/* 结果：查看大图 / 下载 / 删除 */}
              {canUseImageActions ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("infiniteCanvas:viewLargeImage")}
                  title={t("infiniteCanvas:viewLargeImage")}
                  onClick={() => {
                    setViewerIndex(0);
                    setViewerOpen(true);
                  }}
                >
                  <Maximize2 aria-hidden="true" />
                </Button>
              ) : null}
              {data.kind === "imageGenerator" || canUseImageActions ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={!canUseImageActions || isDownloadBusy}
                  aria-label={t("infiniteCanvas:downloadImage")}
                  title={t("infiniteCanvas:downloadImage")}
                  onClick={downloadImage}
                >
                  {isDownloadBusy
                    ? <LoaderCircle className="animate-spin" aria-hidden="true" />
                    : <Download aria-hidden="true" />}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="destructive"
                size="icon-sm"
                aria-label={t("common:actions.delete")}
                title={t("common:actions.delete")}
                onClick={() => void deleteElements({ nodes: [{ id }] })}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </>
          )}
        </NodeToolbar>
      ) : null}

      {data.kind === "assetLoader" ? (
        <input
          ref={fileInputRef}
          className="rf-native-image-input"
          type="file"
          accept="image/*,video/mp4,video/webm,video/quicktime,video/x-m4v,.mp4,.webm,.mov,.m4v"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            if (!isCanvasAssetFile(file)) return;
            const assetType = file.type.startsWith("video/") || /\.(mp4|m4v|mov|webm)$/i.test(file.name) ? "video" as const : "image" as const;
            actions.patchNodeData(id, {
              assetType,
              assetLoadState: "processing",
              assetLoadError: undefined,
            });
            void readMediaFileDimensions(file)
              .then((dimensions) => {
                actions.patchNodeData(id, {
                  assetNaturalWidth: dimensions.width,
                  assetNaturalHeight: dimensions.height,
                });
                if (window.easyTool?.importCanvasAssetFile) {
                  return window.easyTool.importCanvasAssetFile({ file }).then((stored) => {
                    actions.setNodeAsset(id, stored.url, file.name, stored.assetType, stored.mimeType || file.type, {
                      width: stored.width,
                      height: stored.height,
                      durationMs: stored.durationMs,
                      sizeBytes: stored.sizeBytes,
                      thumbUrl: stored.thumbUrl,
                    });
                    return null;
                  });
                }
                return readImageFileAsDataUrl(file).then((imageUrl) => actions.setNodeAsset(id, imageUrl, file.name, "image", file.type));
              })
              .catch((error) => actions.patchNodeData(id, {
                assetLoadState: "error",
                assetLoadError: error instanceof Error ? error.message : String(error),
              }));
          }}
        />
      ) : null}

      {definition.acceptsInput ? isBatchLikeNode ? (
        <>
          <Tooltip open={referenceHintsVisible && !dragging}>
            <TooltipTrigger asChild>
              <Handle
                type="target"
                position={Position.Left}
                id="input"
                style={{ top: "25%" }}
                aria-label={t("infiniteCanvas:mainReference")}
              />
            </TooltipTrigger>
            <TooltipContent side="left">
              {t("infiniteCanvas:mainReference")}
            </TooltipContent>
          </Tooltip>
          <Tooltip open={referenceHintsVisible && !dragging}>
            <TooltipTrigger asChild>
              <Handle
                type="target"
                position={Position.Left}
                id="additional-reference"
                style={{ top: "75%" }}
                aria-label={t("infiniteCanvas:additionalReference")}
              />
            </TooltipTrigger>
            <TooltipContent side="left">
              {t("infiniteCanvas:additionalReference")}
            </TooltipContent>
          </Tooltip>
        </>
      ) : <Handle type="target" position={Position.Left} id="input" /> : null}

      <div ref={nodeFrameRef} className={cn(
        "rf-native-node-frame",
        isAnnotationNode && "rf-native-node-frame--annotation",
        isAnnotationNode && dragging && "is-dragging",
        isGenerating && "is-generating",
      )} style={annotationFrameStyle}>
        <div className={cn(
          "rf-native-node-content",
          isImageNode && "rf-native-node-content--image",
          isPromptNode && "rf-native-node-content--prompt",
          isSmartReverseNode && "rf-native-node-content--image-reverse",
          isAnnotationNode && "rf-native-node-content--annotation",
          isBatchLikeNode && "rf-native-node-content--action-fission",
          isCropping && "is-cropping",
          isGenerating && "is-generating",
          hasGenerationError && "has-generation-error",
        )}>
          {isAnnotationNode ? (
            <AnnotationNodeBody nodeId={id} text={String(data.text || "")} textStyle={data.annotationStyle} />
          ) : isActionFissionNode ? (
            <ActionFissionNodeBody nodeId={id} data={data} paramPanelVisible={toolbarVisible} />
          ) : isBatchImageGeneratorNode ? (
            <BatchImageGeneratorNodeBody nodeId={id} data={data} paramPanelVisible={toolbarVisible} />
          ) : isSmartReverseNode ? (
            <SmartReverseNodeBody nodeId={id} data={data} running={smartReverseRunning} />
          ) : isPromptNode ? (
            <>
              <Textarea
                ref={promptInputRef}
                className={cn(
                  "rf-native-prompt-input nowheel border-0 bg-transparent shadow-none focus-visible:border-0 focus-visible:ring-0",
                  isPromptEditing && "is-editing nodrag nopan",
                )}
                value={data.text || ""}
                readOnly={!isPromptEditing}
                placeholder={t("infiniteCanvas:promptPlaceholder")}
                aria-label={t("infiniteCanvas:prompt")}
                onPointerDown={(event) => {
                  if (isPromptEditing || event.button !== 0 || event.detail < 2) return;
                  event.preventDefault();
                  event.stopPropagation();
                  beginPromptHistoryGesture();
                  beginNodeEditing(id);
                }}
                onDoubleClick={(event) => {
                  if (isPromptEditing) return;
                  event.preventDefault();
                  event.stopPropagation();
                  beginNodeEditing(id);
                }}
                onPointerMove={(event) => {
                  if (isPromptEditing || (event.buttons & 1) === 0) return;
                  const textarea = event.currentTarget;
                  window.requestAnimationFrame(() => {
                    textarea.setSelectionRange(textarea.selectionEnd, textarea.selectionEnd);
                  });
                }}
                onPointerUp={(event) => {
                  if (isPromptEditing) return;
                  const textarea = event.currentTarget;
                  textarea.setSelectionRange(textarea.selectionEnd, textarea.selectionEnd);
                }}
                onBlur={() => {
                  endNodeEditing(id);
                  endPromptHistoryGesture();
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  endNodeEditing(id);
                  endPromptHistoryGesture();
                }}
                onChange={(event) => actions.setNodeText(id, event.currentTarget.value)}
              />
            </>
          ) : isAssetLoading ? (
            <AssetUploadPlaceholder label={t("infiniteCanvas:assetLoading")} />
          ) : isVideoAsset && primaryAssetUrl ? (
            <VideoAssetBody
              sourceUrl={primaryAssetUrl}
              thumbUrl={data.assetThumbUrl}
              label={displayLabel}
              className="rf-upload-asset-ready"
              onCaptureComplete={(asset, mode) => actions.createDerivedAssetNode(id, asset, {
                kind: "frame",
                label: `${displayLabel}-${mode}-frame`,
              })}
            />
          ) : primaryImageUrl ? (
            data.kind === "assetLoader" && isCropping && resolvedPreviewUrl ? (
              <ImageNodeCropEditor
                src={resolvedPreviewUrl}
                fallbackSrc={resolvedPreviewFallbackUrl}
                alt={displayLabel}
                aspect={cropAspect}
                // The crop preview may intentionally use a thumbnail at low
                // canvas zoom.  Convert its percent selection against the
                // asset's original dimensions, never the rendered thumbnail
                // dimensions (legacy image fields remain a fallback).
                sourceWidth={data.assetNaturalWidth || data.imageNaturalWidth}
                sourceHeight={data.assetNaturalHeight || data.imageNaturalHeight}
                onSelectionChange={setCropSelection}
              />
            ) : isMultiImageExpanded ? (
              <div
                className={cn("rf-native-generated-grid", generatedImages.length > 2 && "is-four-up")}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) setMultiImageExpanded(false);
                }}
              >
                {generatedImages.map((result, index) => {
                  const resultUrl = String(result.localUrl || result.url || "");
                  const previewSourceUrl = canvasPreviewSourceUrl(resultUrl, result.thumbUrl);
                  const previewUrl = previewSourceUrl ? resolveLibraryImageUrl(previewSourceUrl) : "";
                  const previewFallbackUrl = resolveLibraryImageUrl(resultUrl);
                  const isPending = result.downloadState !== "downloaded";
                  return (
                    <div
                      key={`${result.localUrl || result.url}-${index}`}
                      className="rf-native-generated-tile"
                      role="group"
                      aria-label={t("infiniteCanvas:generatedImageIndex", { index: index + 1 })}
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setViewerIndex(index);
                        setViewerOpen(true);
                      }}
                    >
                      {previewUrl ? <ImageWithFallback src={previewUrl} fallbackSrc={previewFallbackUrl} deferSourceChange alt={displayLabel} loading="lazy" decoding="async" draggable={false} /> : <Images aria-hidden="true" />}
                      <div className="rf-native-generated-tile-actions nodrag nopan nowheel">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className={cn("rf-native-generated-tile-action", isPending && "is-pending")}
                          aria-label={t("infiniteCanvas:downloadImage")}
                          title={t("infiniteCanvas:downloadImage")}
                          onClick={(event) => {
                            event.stopPropagation();
                            void actions.downloadNodeImage(id, index);
                          }}
                        >
                          <Download aria-hidden="true" />
                        </Button>
                      </div>
                      {index === 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="rf-native-generated-collapse nodrag nopan nowheel"
                          aria-label={t("infiniteCanvas:collapseGeneratedImages")}
                          title={t("infiniteCanvas:collapseGeneratedImages")}
                          onClick={(event) => {
                            event.stopPropagation();
                            setMultiImageExpanded(false);
                          }}
                        >
                          <ChevronUp aria-hidden="true" />
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : resolvedPreviewUrl ? hasMultipleGeneratedImages ? (
              <>
                <ImageWithFallback
                  className={data.kind === "assetLoader" ? "rf-upload-asset-ready" : undefined}
                  src={resolvedPreviewUrl}
                  fallbackSrc={resolvedPreviewFallbackUrl}
                  deferSourceChange
                  alt={displayLabel}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setViewerIndex(0);
                    setViewerOpen(true);
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="rf-native-generated-count nodrag nopan nowheel"
                  aria-label={t("infiniteCanvas:expandGeneratedImages", { count: generatedImages.length })}
                  title={t("infiniteCanvas:expandGeneratedImages", { count: generatedImages.length })}
                  onClick={(event) => {
                    event.stopPropagation();
                    setMultiImageExpanded(true);
                  }}
                >
                  <Maximize2 aria-hidden="true" />
                  {t("infiniteCanvas:imageCountShort", { count: generatedImages.length })}
                </Button>
              </>
            ) : (
              <ImageWithFallback
                className={data.kind === "assetLoader" ? "rf-upload-asset-ready" : undefined}
                src={resolvedPreviewUrl}
                fallbackSrc={resolvedPreviewFallbackUrl}
                deferSourceChange
                alt={displayLabel}
                loading="lazy"
                decoding="async"
                draggable={false}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setViewerIndex(0);
                  setViewerOpen(true);
                }}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (data.kind === "imageGenerator" || primaryImage?.thumbUrl) return;
                  if (!image.naturalWidth || !image.naturalHeight) return;
                  if (image.naturalWidth === imageWidth && image.naturalHeight === imageHeight) return;
                  actions.patchNodeDataSilently(id, {
                    imageNaturalWidth: image.naturalWidth,
                    imageNaturalHeight: image.naturalHeight,
                  });
                }}
              />
            ) : (
              <div className="rf-native-image-placeholder" aria-label={t("infiniteCanvas:imagePreviewUnavailable")}>
                <Images aria-hidden="true" />
              </div>
            )
          ) : data.kind === "assetLoader" && assetLoadError ? (
            <div className="rf-native-image-placeholder is-error" role="alert">
              <CircleAlert aria-hidden="true" />
              <span>{assetLoadError}</span>
            </div>
          ) : data.kind === "assetLoader" ? (
            <div className="rf-native-image-empty">
              <Button className="nodrag justify-start" type="button" variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload data-icon="inline-start" aria-hidden="true" />
                {t("common:actions.uploadAsset")}
              </Button>
              <Button className="nodrag justify-start" type="button" variant="ghost" size="sm" onClick={() => actions.openLibraryForNode(id)}>
                <Images data-icon="inline-start" aria-hidden="true" />
                {t("infiniteCanvas:importFromLibrary")}
              </Button>
            </div>
          ) : showImageGeneratorEmptyIcon ? (
            <ImageAiFillIcon className="rf-native-image-generator-empty-icon" aria-hidden="true" />
          ) : null}
          {imageResolution && primaryImageUrl && !isCropping && !isGenerating && !hasGenerationError && !isMultiImageExpanded ? (
            <span className="rf-native-image-resolution">{imageResolution}</span>
          ) : null}
          {data.kind === "assetLoader" && primaryImageUrl && !isCropping ? (
            <Button
              className="rf-native-image-upload nodrag nopan nowheel"
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("common:actions.uploadAsset")}
              title={t("common:actions.uploadAsset")}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                fileInputRef.current?.click();
              }}
            >
              <Upload aria-hidden="true" />
            </Button>
          ) : null}
          {showGeneratorDownload && !hasMultipleGeneratedImages ? (
            <Button
              className={cn("rf-native-image-download nodrag nopan nowheel", isPendingDownload && "is-pending")}
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={isDownloadBusy}
              aria-label={t(isPendingDownload ? "infiniteCanvas:imagePendingDownload" : "infiniteCanvas:imageDownloaded")}
              title={t(isPendingDownload ? "infiniteCanvas:imagePendingDownload" : "infiniteCanvas:imageDownloaded")}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                downloadImage();
              }}
            >
              <Download aria-hidden="true" />
            </Button>
          ) : null}
          {isGenerating && !isLaunching ? (
            <span
              className="rf-native-generation-timer"
              aria-label={t("infiniteCanvas:generationElapsed", { time: elapsedText })}
            >
              {elapsedText}
            </span>
          ) : null}
          {isGenerating && generationMessage ? (
            <div
              className="rf-native-generation-status"
              role="status"
              aria-live="polite"
            >
              <span>{generationMessage}</span>
            </div>
          ) : null}
          {hasGenerationError && generationMessage ? <GenerationErrorStatus message={generationMessage} /> : null}
          {hasGenerationError && generationMessage ? (
            <div className="rf-native-generation-error-actions nodrag nopan nowheel">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("common:actions.copyError")}
                title={t("common:actions.copyError")}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  void copyText(generationMessage).then(() => toast.success(t("infiniteCanvas:textCopied")));
                }}
              >
                <Copy aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("common:actions.back")}
                title={t("common:actions.back")}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  clearNodeGenerationRuntimeErrors(id);
                  if (taskId) useGenerationRuntimeStore.getState().dismissTask(taskId);
                }}
              >
                <ArrowLeft aria-hidden="true" />
              </Button>
            </div>
          ) : null}
        </div>
        {definition.resizable && !isMultiImageExpanded ? <NativeNodeResizeControl nodeId={id} {...definition.resizable} /> : null}
      </div>

      {data.kind === "imageGenerator" ? (
        <ImageGeneratorParamPanel nodeId={id} data={data} visible={toolbarVisible} />
      ) : null}
      {data.kind === "smartReverse" ? (
        <SmartReverseParamPanel nodeId={id} data={data} visible={toolbarVisible} />
      ) : null}

      {definition.providesOutput ? <Handle type="source" position={Position.Right} id="output" /> : null}
      {viewerOpen && viewerSrc && data.kind === "imageGenerator" ? (
        <ImageGeneratorImageViewer
          nodeId={id}
          src={viewerSrc}
          alt={displayLabel}
          onClose={() => setViewerOpen(false)}
          navigation={viewerNavigation}
        />
      ) : viewerOpen && viewerSrc ? (
        <ImageViewer
          src={viewerSrc}
          alt={displayLabel}
          ariaLabel={t("infiniteCanvas:viewLargeImage")}
          onClose={() => setViewerOpen(false)}
          navigation={viewerNavigation}
        />
      ) : null}
    </>
  );
});
