import { Handle, NodeToolbar, Position, useReactFlow, useStore, useUpdateNodeInternals, type NodeProps } from "@xyflow/react";
import ImageAiFillIcon from "@iconify-react/ri/image-ai-fill";
import { ArrowLeft, Check, ChevronUp, CircleAlert, Copy, Crop, Download, Images, LoaderCircle, Maximize2, Trash2, Upload, X } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AppSelect } from "../../../components/AppSelect";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";
import { copyText } from "../../../components/ErrorCopyLine";
import { ImageViewer } from "../../../lib/ImageViewer";
import { resolveLibraryImageUrl } from "../../../lib/libraryImageActions";
import { cn } from "../../../lib/utils";
import { readImageFileAsDataUrl, useNativeCanvasActions, type CanvasImageCropRect } from "../canvasActions";
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
import { formatGenerationDuration, generationStatusMessage } from "../generation/generationStatus";
import {
  clearNodeGenerationRuntimeErrors,
  isImageNodeLaunching,
  useGenerationRuntimeStore,
} from "../generation/generationRuntimeStore";
import { isGenerationTaskActive, useGenerationTaskCache } from "../generation/generationTaskCache";
import { ImageNodeCropEditor, type ImageCropAspect } from "./ImageNodeCropEditor";

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

export const NativeCanvasNode = memo(function NativeCanvasNode({ id, data, selected }: NodeProps<NativeCanvasNodeType>) {
  const { t } = useTranslation();
  const { deleteElements, getNode, setNodes } = useReactFlow<NativeCanvasNodeType, NativeCanvasEdge>();
  const updateNodeInternals = useUpdateNodeInternals();
  const toolbarOffset = useStore((state) => state.transform[2]) * 20;
  const actions = useNativeCanvasActions();
  const nodeFrameRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const isPromptEditing = useNativeCanvasInteractionStore((state) => state.editingNodeId === id);
  const isNodeToolbarActive = useNativeCanvasInteractionStore((state) => state.toolbarNodeId === id);
  const beginNodeEditing = useNativeCanvasInteractionStore((state) => state.beginNodeEditing);
  const endNodeEditing = useNativeCanvasInteractionStore((state) => state.endNodeEditing);
  const definition = NATIVE_CANVAS_NODE_DEFINITIONS[data.kind];
  const displayLabel = data.kind === "imageLoader" && data.imageUrl && data.label
    ? data.label
    : t(`infiniteCanvas:${definition.labelKey}`);
  const Icon = definition.icon;
  const isImageNode = data.kind === "imageLoader" || data.kind === "imageGenerator";
  const isPromptNode = data.kind === "prompt";
  const isActionFissionNode = data.kind === "actionFission";
  const isContentOnlyNode = isImageNode || isPromptNode || isActionFissionNode;
  const isLaunching = useGenerationRuntimeStore((state) => isImageNodeLaunching(state.launchingKeys, id));
  const taskId = nativeCanvasNodeTaskId(data);
  const activeGenerationTask = useGenerationTaskCache((state) => taskId ? state.tasksById[taskId] : undefined);
  const runtimeError = useGenerationRuntimeStore((state) => Object.entries(state.errorsByKey)
    .find(([key]) => key.endsWith(`:node:${id}`))?.[1] || "");
  const taskDismissed = useGenerationRuntimeStore((state) => taskId ? state.dismissedTaskIds.has(taskId) : false);
  const activeGenerationError = runtimeError
    || (!taskDismissed && activeGenerationTask?.status === "failed" ? String(activeGenerationTask.errorMessage || "") : "");
  const isGenerating = data.kind === "imageGenerator" && (isLaunching || isGenerationTaskActive(activeGenerationTask));
  const hasGenerationError = data.kind === "imageGenerator" && !isGenerating && Boolean(activeGenerationError);
  const generationMessage = isGenerating
    ? isLaunching
      ? t("infiniteCanvas:generationPreparing")
      : generationStatusMessage(activeGenerationTask, t) || t("infiniteCanvas:running")
    : hasGenerationError ? activeGenerationError : "";
  const [timerNow, setTimerNow] = useState(Date.now());
  const [isDownloadBusy, setIsDownloadBusy] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [isCropping, setIsCropping] = useState(false);
  const [cropAspect, setCropAspect] = useState<ImageCropAspect>("original");
  const [cropSelection, setCropSelection] = useState<CanvasImageCropRect | null>(null);
  const [isCropBusy, setIsCropBusy] = useState(false);
  const generationStartedAt = Number(activeGenerationTask?.runningAt || activeGenerationTask?.startedAt || 0);
  const elapsedText = formatGenerationDuration(generationStartedAt ? timerNow - generationStartedAt : 0);
  const imageWidth = Math.round(Number(data.imageNaturalWidth || 0));
  const imageHeight = Math.round(Number(data.imageNaturalHeight || 0));
  const imageResolution = imageWidth > 0 && imageHeight > 0 ? `${imageWidth} x ${imageHeight}` : "";
  const generatedImages = data.kind === "imageGenerator"
    ? (data.generatedImages || []).filter((result) => result.localUrl || result.url)
    : [];
  const primaryImage = nativeCanvasNodePrimaryImage(data);
  const primaryImageUrl = String(primaryImage?.localUrl || primaryImage?.url || "");
  const showGeneratorDownload = data.kind === "imageGenerator" && Boolean(primaryImageUrl) && !isGenerating && !hasGenerationError;
  const isPendingDownload = showGeneratorDownload && primaryImage?.downloadState !== "downloaded";
  const canUseImageActions = isImageNode && Boolean(primaryImageUrl) && !isGenerating && !hasGenerationError;
  const resolvedImageUrl = primaryImageUrl ? resolveLibraryImageUrl(primaryImageUrl) : "";
  const resolvedPreviewUrl = primaryImage?.thumbUrl ? resolveLibraryImageUrl(primaryImage.thumbUrl) : resolvedImageUrl;
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

  const downloadImage = () => {
    if (isDownloadBusy) return;
    setIsDownloadBusy(true);
    void actions.downloadGeneratedImage(id, 0).catch(() => undefined).finally(() => setIsDownloadBusy(false));
  };

  const cancelCrop = () => {
    if (isCropBusy) return;
    setIsCropping(false);
    setCropSelection(null);
  };

  const confirmCrop = () => {
    if (!cropSelection || isCropBusy) return;
    setIsCropBusy(true);
    void actions.cropNodeImage(id, cropSelection)
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
      width: Math.max(1, Number(node?.measured?.width || node?.width || 0)),
      height: Math.max(1, Number(node?.measured?.height || node?.height || 0)),
    };
    actions.patchNodeData(id, {
      multiImageExpanded: expanded,
      multiImageCollapsedSize: collapsedSize,
    });
  }, [actions, data.multiImageCollapsedSize, getNode, hasMultipleGeneratedImages, id]);

  useEffect(() => {
    if (!isPromptEditing) return;
    promptInputRef.current?.focus();
    promptInputRef.current?.select();
  }, [isPromptEditing]);

  useEffect(() => {
    if (!isGenerating || isLaunching) return;
    setTimerNow(Date.now());
    const interval = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isGenerating, isLaunching]);

  useLayoutEffect(() => {
    if (data.kind !== "imageGenerator" || !hasMultipleGeneratedImages) return;
    const node = getNode(id);
    const measuredWidth = Math.max(1, Number(node?.measured?.width || node?.width || 0));
    const measuredHeight = Math.max(1, Number(node?.measured?.height || node?.height || 0));
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

  return (
    <>
      {selected && isNodeToolbarActive ? (
        <NodeToolbar nodeId={id} position={Position.Top} offset={toolbarOffset} className="rf-native-node-toolbar">
          {isCropping ? (
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
              <Button
                type="button"
                variant="default"
                size="icon-sm"
                disabled={!cropSelection || isCropBusy}
                aria-label={t("common:actions.confirm")}
                title={t("common:actions.confirm")}
                onClick={confirmCrop}
              >
                {isCropBusy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
              </Button>
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
          ) : data.kind === "imageLoader" ? (
            <>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t("common:actions.uploadImage")} onClick={() => fileInputRef.current?.click()}>
                <Upload aria-hidden="true" />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t("infiniteCanvas:importFromLibrary")} onClick={() => actions.openLibraryForNode(id)}>
                <Images aria-hidden="true" />
              </Button>
            </>
          ) : null}
          {!isCropping && canUseImageActions ? (
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
          {data.kind === "imageLoader" && primaryImageUrl && !isCropping ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("infiniteCanvas:cropImage")}
              title={t("infiniteCanvas:cropImage")}
              onClick={() => {
                setCropAspect("original");
                setCropSelection(null);
                setIsCropping(true);
              }}
            >
              <Crop aria-hidden="true" />
            </Button>
          ) : null}
          {data.kind === "imageGenerator" && canUseImageActions ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={isDownloadBusy}
              aria-label={t("infiniteCanvas:downloadImage")}
              title={t("infiniteCanvas:downloadImage")}
              onClick={downloadImage}
            >
              <Download aria-hidden="true" />
            </Button>
          ) : null}
          {!isCropping ? <Button
              type="button"
              variant="destructive"
              size="icon-sm"
            aria-label={t("common:actions.delete")}
            onClick={() => void deleteElements({ nodes: [{ id }] })}
          >
            <Trash2 aria-hidden="true" />
          </Button> : null}
        </NodeToolbar>
      ) : null}

      {data.kind === "imageLoader" ? (
        <input
          ref={fileInputRef}
          className="rf-native-image-input"
          type="file"
          accept="image/*"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            void readImageFileAsDataUrl(file).then((imageUrl) => actions.setNodeImage(id, imageUrl, file.name));
          }}
        />
      ) : null}

      {definition.acceptsInput ? isActionFissionNode ? (
        <>
          <Handle
            type="target"
            position={Position.Left}
            id="input"
            style={{ top: "25%" }}
            aria-label={t("infiniteCanvas:mainReference")}
            title={t("infiniteCanvas:mainReference")}
          />
          <Handle
            type="target"
            position={Position.Left}
            id="additional-reference"
            style={{ top: "75%" }}
            aria-label={t("infiniteCanvas:additionalReference")}
            title={t("infiniteCanvas:additionalReference")}
          />
        </>
      ) : <Handle type="target" position={Position.Left} id="input" /> : null}

      <div ref={nodeFrameRef} className={cn(
        "rf-native-node-frame",
        isContentOnlyNode && "rf-native-node-frame--content-only",
        isGenerating && "is-generating",
      )}>
        {!isContentOnlyNode ? (
          <header className="rf-native-node-header">
            <Icon aria-hidden="true" />
            <span>{displayLabel}</span>
          </header>
        ) : null}
        <div className={cn(
          "rf-native-node-content",
          isImageNode && "rf-native-node-content--image",
          isPromptNode && "rf-native-node-content--prompt",
          isActionFissionNode && "rf-native-node-content--action-fission",
          isCropping && "is-cropping",
          isGenerating && "is-generating",
          hasGenerationError && "has-generation-error",
        )}>
          {isActionFissionNode ? (
            <ActionFissionNodeBody nodeId={id} data={data} paramPanelVisible={selected && isNodeToolbarActive} />
          ) : isPromptNode ? (
            <>
              <Textarea
                ref={promptInputRef}
                className="rf-native-prompt-input nodrag nowheel border-0 bg-transparent shadow-none focus-visible:border-0 focus-visible:ring-0"
                value={data.text || ""}
                readOnly={!isPromptEditing}
                placeholder={t("infiniteCanvas:promptPlaceholder")}
                aria-label={t("infiniteCanvas:prompt")}
                onBlur={() => endNodeEditing(id)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  endNodeEditing(id);
                }}
                onChange={(event) => actions.setNodeText(id, event.currentTarget.value)}
              />
              {!isPromptEditing ? (
                <div
                  className="rf-native-prompt-edit-shield"
                  onPointerDown={(event) => {
                    if (event.button !== 0 || event.detail < 2) return;
                    event.preventDefault();
                    event.stopPropagation();
                    beginNodeEditing(id);
                  }}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    beginNodeEditing(id);
                  }}
                />
              ) : null}
            </>
          ) : primaryImageUrl ? (
            data.kind === "imageLoader" && isCropping ? (
              <ImageNodeCropEditor
                src={resolvedImageUrl}
                alt={displayLabel}
                aspect={cropAspect}
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
                  const previewUrl = resolveLibraryImageUrl(String(result.thumbUrl || result.localUrl || result.url || ""));
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
                      <img src={previewUrl} alt={displayLabel} draggable={false} />
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
                            void actions.downloadGeneratedImage(id, index);
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
            ) : hasMultipleGeneratedImages ? (
              <>
                <img
                  src={resolvedPreviewUrl}
                  alt={displayLabel}
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
              <img
                src={resolvedPreviewUrl}
                alt={displayLabel}
                draggable={false}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setViewerIndex(0);
                  setViewerOpen(true);
                }}
                onLoad={(event) => {
                  const image = event.currentTarget;
                  if (primaryImage?.thumbUrl) return;
                  if (!image.naturalWidth || !image.naturalHeight) return;
                  if (image.naturalWidth === imageWidth && image.naturalHeight === imageHeight) return;
                  actions.patchNodeData(id, {
                    imageNaturalWidth: image.naturalWidth,
                    imageNaturalHeight: image.naturalHeight,
                  });
                }}
              />
            )
          ) : data.kind === "imageLoader" ? (
            <div className="rf-native-image-empty">
              <Button className="nodrag justify-start" type="button" variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload data-icon="inline-start" aria-hidden="true" />
                {t("common:actions.uploadImage")}
              </Button>
              <Button className="nodrag justify-start" type="button" variant="ghost" size="sm" onClick={() => actions.openLibraryForNode(id)}>
                <Images data-icon="inline-start" aria-hidden="true" />
                {t("infiniteCanvas:importFromLibrary")}
              </Button>
            </div>
          ) : data.kind === "imageGenerator" ? (
            <ImageAiFillIcon className="rf-native-image-generator-empty-icon" aria-hidden="true" />
          ) : null}
          {imageResolution && primaryImageUrl && !isCropping && !isGenerating && !hasGenerationError && !isMultiImageExpanded ? (
            <span className="rf-native-image-resolution">{imageResolution}</span>
          ) : null}
          {data.kind === "imageLoader" && primaryImageUrl && !isCropping ? (
            <Button
              className="rf-native-image-upload nodrag nopan nowheel"
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("common:actions.uploadImage")}
              title={t("common:actions.uploadImage")}
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
        <ImageGeneratorParamPanel nodeId={id} data={data} visible={selected && isNodeToolbarActive} />
      ) : null}

      {definition.providesOutput ? <Handle type="source" position={Position.Right} id="output" /> : null}
      {viewerOpen && viewerSrc ? (
        <ImageViewer
          src={viewerSrc}
          alt={displayLabel}
          ariaLabel={t("infiniteCanvas:viewLargeImage")}
          onClose={() => setViewerOpen(false)}
          navigation={viewerImages.length > 1 ? {
            index: viewerIndex,
            total: viewerImages.length,
            previousLabel: t("infiniteCanvas:previousImage"),
            nextLabel: t("infiniteCanvas:nextImage"),
            onPrevious: () => setViewerIndex((current) => (current - 1 + viewerImages.length) % viewerImages.length),
            onNext: () => setViewerIndex((current) => (current + 1) % viewerImages.length),
          } : undefined}
        />
      ) : null}
    </>
  );
});
