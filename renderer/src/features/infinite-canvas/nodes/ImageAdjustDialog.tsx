import { ChevronDown, GripVertical, Images, LoaderCircle, Maximize2, Plus, RotateCcw, SlidersHorizontal, Sparkles, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { AppScrollArea } from "../../../components/AppScrollArea";
import { DraggableList } from "../../../components/DraggableList";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Slider } from "../../../components/ui/slider";
import { Input } from "../../../components/ui/input";
import { NativeTabs } from "../../../components/NativeTabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { cn } from "../../../lib/utils";
import {
  DEFAULT_IMAGE_ADJUSTMENTS,
  IMAGE_ADJUSTMENT_CONTROLS,
  IMAGE_ADJUSTMENT_CLARITY_MAX_AMOUNT,
  imageAdjustmentClaritySigma,
  type ImageAdjustmentControl,
  isDefaultImageAdjustments,
  normalizeImageAdjustments,
  type ImageAdjustmentKey,
  type NativeCanvasImageAdjustments,
} from "../imageAdjustments";
import { createImageAdjustPreviewRenderer } from "../imageAdjustPreviewRenderer";
import { isGenerationTaskActive, useGenerationTaskCache } from "../generation/generationTaskCache";
import {
  nextImagePresetIndex,
  useImagePresetStore,
  type ImagePresetRecord,
} from "../imagePresets";

const CONTROL_LABEL_KEYS: Record<Exclude<ImageAdjustmentKey, "noiseMode">, string> = {
  brightness: "imageAdjustBrightness",
  contrast: "imageAdjustContrast",
  saturation: "imageAdjustSaturation",
  grayscale: "imageAdjustGrayscale",
  hue: "imageAdjustHue",
  clarity: "imageAdjustClarity",
  blur: "imageAdjustBlur",
  noise: "imageAdjustNoise",
  speckle: "imageAdjustSpeckle",
};

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 32;

interface PreviewView {
  /** 屏幕 1 像素对应多少图像像素的倒数（屏幕 px / 图像 px）。 */
  scale: number;
  /** 画布左上角对应的图像坐标。 */
  offsetX: number;
  offsetY: number;
}

/**
 * 把视图限制在合理范围。
 *
 * offset 是"画布左上角对应的图像坐标"，d = 图像尺寸 - 可见尺寸：
 *   d > 0（图比视口大）→ offset ∈ [0, d]，不许拖出黑边；
 *   d < 0（图比视口小）→ offset ∈ [d, 0]，图只能待在视口内，但不能被钉死，
 *                        否则用户会觉得"拖不动"。
 */
function clampView(view: PreviewView, boxWidth: number, boxHeight: number, imageWidth: number, imageHeight: number): PreviewView {
  const visibleWidth = boxWidth / view.scale;
  const visibleHeight = boxHeight / view.scale;
  const axis = (offset: number, imageSize: number, visible: number) => {
    const span = imageSize - visible;
    return clamp(offset, Math.min(0, span), Math.max(0, span));
  };
  const offsetX = axis(view.offsetX, imageWidth, visibleWidth);
  const offsetY = axis(view.offsetY, imageHeight, visibleHeight);
  return offsetX === view.offsetX && offsetY === view.offsetY
    ? view
    : { ...view, offsetX, offsetY };
}

function centeredView(scale: number, boxWidth: number, boxHeight: number, imageWidth: number, imageHeight: number): PreviewView {
  return {
    scale,
    offsetX: (imageWidth - boxWidth / scale) / 2,
    offsetY: (imageHeight - boxHeight / scale) / 2,
  };
}

/** 滑块右侧那个数值框的显示/换算规则：亮度这类倍数按百分比显示，色相按度，模糊按像素。 */
const CONTROL_DISPLAY: Record<ImageAdjustmentKey, {
  unit: string;
  decimals: number;
  toDisplay: (value: number) => number;
  fromDisplay: (value: number) => number;
}> = {
  brightness: { unit: "%", decimals: 0, toDisplay: (v) => v * 100, fromDisplay: (v) => v / 100 },
  contrast: { unit: "%", decimals: 0, toDisplay: (v) => v * 100, fromDisplay: (v) => v / 100 },
  saturation: { unit: "%", decimals: 0, toDisplay: (v) => v * 100, fromDisplay: (v) => v / 100 },
  grayscale: { unit: "%", decimals: 0, toDisplay: (v) => v * 100, fromDisplay: (v) => v / 100 },
  hue: { unit: "°", decimals: 0, toDisplay: (v) => v, fromDisplay: (v) => v },
  clarity: { unit: "%", decimals: 0, toDisplay: (v) => v, fromDisplay: (v) => v },
  blur: { unit: "px", decimals: 1, toDisplay: (v) => v, fromDisplay: (v) => v },
  noise: { unit: "%", decimals: 0, toDisplay: (v) => v, fromDisplay: (v) => v },
  speckle: { unit: "%", decimals: 0, toDisplay: (v) => v, fromDisplay: (v) => v },
};

/**
 * 滑块右侧的数值框：显示当前值，也允许直接输入。
 * 输入过程只改本地草稿，回车/失焦才提交并夹到合法范围，非法输入直接还原。
 */
function AdjustmentValueInput({
  value, control, disabled, onCommit,
}: {
  value: number;
  control: ImageAdjustmentControl;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const display = CONTROL_DISPLAY[control.key];
  const formatted = display.toDisplay(value).toFixed(display.decimals);
  const [draft, setDraft] = useState(formatted);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(formatted);
  }, [editing, formatted]);

  const commit = () => {
    setEditing(false);
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(formatted);
      return;
    }
    const next = clamp(display.fromDisplay(parsed), control.min, control.max);
    setDraft(display.toDisplay(next).toFixed(display.decimals));
    onCommit(next);
  };

  return (
    <span className="rf-image-adjust__input">
      <Input
        // 和 InputGroupInput 一样：带这个标记的输入框不吃全局 input 的边框/底色
        data-slot="input-group-control"
        className="h-6 rounded-none border-0 bg-transparent p-0 text-right text-xs tabular-nums text-[var(--text-secondary)] shadow-none focus-visible:ring-0 dark:bg-transparent"
        type="text"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        aria-label={control.key}
        onFocus={() => setEditing(true)}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            setEditing(false);
            setDraft(formatted);
            event.currentTarget.blur();
          }
        }}
      />
      <span className="rf-image-adjust__unit">{display.unit}</span>
    </span>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** 组图像调节：预览下方轨道里的一项。 */
export interface ImageAdjustTargetOption {
  key: string;
  label: string;
  thumbnailUrl: string;
  taskId?: string;
  isAssetLoading?: boolean;
}

interface ImageAdjustDialogProps {
  open: boolean;
  label: string;
  /** 原图地址：预览拿它当纹理，导出也用它。 */
  sourceUrl: string;
  /** 原图加载失败时的兜底（一般是缩略图），只在预览阶段用。 */
  fallbackUrl?: string;
  naturalWidth: number;
  naturalHeight: number;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (
    adjustments: NativeCanvasImageAdjustments,
    localSourceUrl: string,
    mode: "newNode" | "overwrite",
  ) => void;
  /** 组入口：组内所有可调节的图片；不传时面板保持单节点形态。 */
  targets?: ImageAdjustTargetOption[];
  activeTargetKey?: string;
  onSelectTarget?: (key: string) => void;
  /**
   * 组入口专用：保存整组。entries 是每张图各自当前的参数（组内每张可以调得不一样）。
   */
  onSaveGroup?: (
    entries: Array<{ key: string; adjustments: NativeCanvasImageAdjustments }>,
    localSourceUrl: string,
  ) => void;
  /** 保存整组的进度，运行期间面板整体禁用。 */
  groupSaveProgress?: { done: number; total: number } | null;
}

/** 轨道项自己订阅生成任务，避免整个画布页面跟着任务心跳重渲染。 */
function ImageAdjustTargetButton({
  target,
  index,
  active,
  disabled,
  onSelect,
}: {
  target: ImageAdjustTargetOption;
  index: number;
  active: boolean;
  disabled: boolean;
  onSelect?: (key: string) => void;
}) {
  const { t } = useTranslation();
  const task = useGenerationTaskCache((state) => (target.taskId ? state.tasksById[target.taskId] : undefined));
  const disabledReason = target.isAssetLoading
    ? t("infiniteCanvas:imageAdjustTargetLoading")
    : isGenerationTaskActive(task)
      ? t("infiniteCanvas:imageAdjustTargetGenerating")
      : "";
  return (
    <div className="rf-image-adjust__target-slot" role="listitem">
      <button
        type="button"
        className={cn("rf-image-adjust__target", active && "is-active")}
        disabled={disabled || Boolean(disabledReason)}
        aria-current={active}
        aria-label={disabledReason ? `${target.label} · ${disabledReason}` : target.label}
        title={disabledReason || target.label}
        onClick={() => onSelect?.(target.key)}
      >
        {target.thumbnailUrl
          ? <img src={target.thumbnailUrl} alt="" loading="lazy" decoding="async" draggable={false} />
          : <Images aria-hidden="true" />}
        <span className="rf-image-adjust__target-index">{index + 1}</span>
      </button>
      <span className="rf-image-adjust__target-label" title={target.label}>{target.label}</span>
    </div>
  );
}

export function ImageAdjustDialog({
  open,
  label,
  sourceUrl,
  fallbackUrl,
  naturalWidth,
  naturalHeight,
  busy,
  onOpenChange,
  onApply,
  targets,
  activeTargetKey,
  onSelectTarget,
  onSaveGroup,
  groupSaveProgress = null,
}: ImageAdjustDialogProps) {
  const { t } = useTranslation();
  // 组入口固定"覆盖原图"：整组浏览时不再提供派生新节点的分支。
  const groupMode = Boolean(targets?.length);
  const savingGroup = Boolean(groupSaveProgress);
  const rendererRef = useRef<ReturnType<typeof createImageAdjustPreviewRenderer> | null>(null);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [rendererReady, setRendererReady] = useState(false);
  /** 换一张画布重试 WebGL 用；某些机器冷启动时第一次拿不到上下文。 */
  const [canvasGeneration, setCanvasGeneration] = useState(0);
  /** 手动/自动重试的令牌：纹理加载和 GL 初始化都依赖它。 */
  const [retryToken, setRetryToken] = useState(0);
  const glRetryRef = useRef(0);
  const loadRetryRef = useRef(0);
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [texture, setTexture] = useState<{ width: number; height: number } | null>(null);
  const [localSourceUrl, setLocalSourceUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [adjustments, setAdjustments] = useState<NativeCanvasImageAdjustments>(DEFAULT_IMAGE_ADJUSTMENTS);
  /** 组内每张图各自的参数：切到别的图再切回来时不能丢已经调过的数值。 */
  const [adjustmentsByTarget, setAdjustmentsByTarget] = useState<Record<string, NativeCanvasImageAdjustments>>({});
  const adjustmentsByTargetRef = useRef<Record<string, NativeCanvasImageAdjustments>>({});
  const adjustmentsRef = useRef<NativeCanvasImageAdjustments>(DEFAULT_IMAGE_ADJUSTMENTS);
  adjustmentsRef.current = adjustments;
  const [comparing, setComparing] = useState(false);
  const [tab, setTab] = useState<"presets" | "adjust">("presets");
  const presets = useImagePresetStore((state) => state.presets);
  const presetsLoaded = useImagePresetStore((state) => state.loaded);
  const loadPresets = useImagePresetStore((state) => state.load);
  const savePresets = useImagePresetStore((state) => state.savePresets);
  const createPreset = useImagePresetStore((state) => state.createPreset);
  const renamePreset = useImagePresetStore((state) => state.renamePreset);
  const removePreset = useImagePresetStore((state) => state.removePreset);
  const [renamingPresetId, setRenamingPresetId] = useState("");
  const [presetNameDraft, setPresetNameDraft] = useState("");
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [view, setView] = useState<PreviewView>({ scale: 0, offsetX: 0, offsetY: 0 });
  const viewImageRef = useRef("");
  const panRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const splitDragRef = useRef<number | null>(null);

  // 重置只在"打开"这一刻发生一次。之前把 presetsLoaded 也放进依赖里，
  // 结果预设加载完成时会把已经算好的视口缩放又重置回 0（画面全透明），
  // 而居中 effect 的依赖没变、不会再跑，预览就一直空着。
  const resetTokenRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (resetTokenRef.current === open) return;
    resetTokenRef.current = open;
    if (!open) return;
    glRetryRef.current = 0;
    loadRetryRef.current = 0;
    setCanvasGeneration(0);
    setRetryToken(0);
    setAdjustments(DEFAULT_IMAGE_ADJUSTMENTS);
    setComparing(false);
    setTab("presets");
    setSplitEnabled(false);
    setSplitRatio(0.5);
    setView({ scale: 0, offsetX: 0, offsetY: 0 });
  }, [open]);

  // 预设是全局的，加载一次就够，和上面那个重置彻底解耦。
  useEffect(() => {
    if (!open || presetsLoaded) return;
    void loadPresets();
  }, [loadPresets, open, presetsLoaded]);

  // 组内切换图片：先把上一张的参数存起来，再恢复这张自己的参数（没调过才是默认值）。
  const activeTargetKeyRef = useRef("");
  useEffect(() => {
    if (!open) {
      activeTargetKeyRef.current = "";
      adjustmentsByTargetRef.current = {};
      setAdjustmentsByTarget({});
      return;
    }
    if (!activeTargetKey || activeTargetKeyRef.current === activeTargetKey) return;
    const previousKey = activeTargetKeyRef.current;
    if (previousKey) {
      const withPrevious = { ...adjustmentsByTargetRef.current, [previousKey]: adjustmentsRef.current };
      adjustmentsByTargetRef.current = withPrevious;
      setAdjustmentsByTarget(withPrevious);
    }
    activeTargetKeyRef.current = activeTargetKey;
    setAdjustments(adjustmentsByTargetRef.current[activeTargetKey] || DEFAULT_IMAGE_ADJUSTMENTS);
    setComparing(false);
    setSplitEnabled(false);
    setSplitRatio(0.5);
    setView({ scale: 0, offsetX: 0, offsetY: 0 });
  }, [activeTargetKey, open]);

  // 远程地址和 data URL 先落成画布素材，预览和导出都走它，避免导出时再复制一份。
  useEffect(() => {
    if (!open || !sourceUrl) return;
    if (/^forart-asset:/i.test(sourceUrl)) {
      setLocalSourceUrl(sourceUrl);
      return;
    }
    let canceled = false;
    const tool = window.easyTool;
    if (!tool?.saveCanvasAsset) {
      // 没有素材存储（浏览器里跑）时不要直接判失败：下面会拿原始地址当候选，
      // data: / http(s): 这类地址照样能当纹理用。
      return;
    }
    // 换图时先清掉上一张的本地素材，否则预览会拿旧纹理顶到新图加载完。
    setLocalSourceUrl("");
    void tool.saveCanvasAsset({ url: sourceUrl, defaultName: label || "canvas-image.png", kind: "input" })
      .then((stored) => {
        if (!canceled) setLocalSourceUrl(stored.url);
      })
      .catch(() => {
        if (!canceled) setFailed(true);
      });
    return () => { canceled = true; };
  }, [label, open, sourceUrl]);

  // 渲染器只在打开期间存在。注意 canvas 用 state 存而不是 ref：对话框内容是 portal
  // 挂载的，ref 有可能拿到 null，effect 又只依赖 open，就再也不会重跑。
  useEffect(() => {
    if (!open || !canvasElement) return;
    const renderer = createImageAdjustPreviewRenderer(canvasElement);
    rendererRef.current = renderer;
    setRendererReady(true);
    let retryTimer: number | undefined;
    if (!renderer.supported) {
      // 冷启动时第一次可能拿不到 WebGL 上下文（GPU 进程还在起），换一张新画布重试；
      // 同一个 canvas 一旦失败会一直返回 null，所以必须换元素。
      setRendererReady(false);
      if (glRetryRef.current < 2) {
        glRetryRef.current += 1;
        retryTimer = window.setTimeout(() => {
          setCanvasElement(null);
          setCanvasGeneration((value) => value + 1);
        }, 250);
      } else {
        setFailed(true);
        setLoading(false);
      }
    } else {
      setFailed(false);
    }
    return () => {
      if (retryTimer) window.clearTimeout(retryTimer);
      renderer.dispose();
      rendererRef.current = null;
      setRendererReady(false);
    };
  }, [canvasElement, open]);

  // 纹理：原图优先，加载失败退回兜底图；超过纹理上限时等比缩到上限。
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!open || !rendererReady || !renderer) return;
    if (!localSourceUrl && !sourceUrl && !fallbackUrl) return;
    let canceled = false;
    setLoading(true);
    // 浏览器里跑（没有 easyTool）时 forart-asset:// 这个协议根本不存在，而且这种地址
    // 既不会触发 onload 也不会触发 onerror，会一直挂着，所以先按协议过滤掉。
    const supportsCustomScheme = Boolean(window.easyTool);
    const candidates = [localSourceUrl, sourceUrl, fallbackUrl]
      .filter((value): value is string => Boolean(value))
      .filter((url, index, list) => list.indexOf(url) === index)
      .filter((url) => supportsCustomScheme || !/^forart-asset:/i.test(url));
    const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.decoding = "async";
      // WebGL 只接受"origin-clean"的图：forart-asset:// 和远程 http(s) 对页面来说都是
      // 跨源，不带 CORS 标识的话 texImage2D 会直接抛 SecurityError。
      // 项目的自定义协议会返回 Access-Control-Allow-Origin: *，所以带上就行。
      if (/^(forart-asset|https?):/i.test(url)) element.crossOrigin = "anonymous";
      const timer = window.setTimeout(() => { finish(); reject(new Error("image load timeout")); }, 4000);
      const finish = () => {
        window.clearTimeout(timer);
        element.onload = null;
        element.onerror = null;
      };
      element.onload = () => { finish(); resolve(element); };
      element.onerror = () => { finish(); reject(new Error("image load failed")); };
      element.src = url;
    });
    const load = async (index: number) => {
      if (canceled) return;
      if (index >= candidates.length) {
        // 第一次加载失败可能只是素材还没就绪（刚生成的图、冷启动的协议），自动重试一次。
        if (loadRetryRef.current < 1) {
          loadRetryRef.current += 1;
          const timer = window.setTimeout(() => setRetryToken((value) => value + 1), 800);
          return () => window.clearTimeout(timer);
        }
        setFailed(true);
        setLoading(false);
        return;
      }
      try {
        const image = await loadImage(candidates[index]);
        if (canceled) return;
        const max = renderer.maxTextureSize || 8192;
        const longEdge = Math.max(image.naturalWidth, image.naturalHeight);
        const resizeTo = async (ratio: number) => {
          const bitmap = await createImageBitmap(image, {
            resizeWidth: Math.max(1, Math.round(image.naturalWidth * ratio)),
            resizeHeight: Math.max(1, Math.round(image.naturalHeight * ratio)),
            resizeQuality: "high",
          });
          return bitmap;
        };
        let source: TexImageSource = image;
        let width = image.naturalWidth;
        let height = image.naturalHeight;
        if (longEdge > max) {
          const bitmap = await resizeTo(max / longEdge);
          source = bitmap;
          width = bitmap.width;
          height = bitmap.height;
        }
        try {
          renderer.setImage(source, width, height);
        } catch (error) {
          // 大图可能超出显存，等比缩一半再试一次，总比整个预览失败强。
          console.warn("[adjust-preview] 纹理上传失败，缩小后重试", error);
          const bitmap = await resizeTo(0.5);
          renderer.setImage(bitmap, bitmap.width, bitmap.height);
          width = bitmap.width;
          height = bitmap.height;
        }
        if (canceled) return;
        setTexture({ width, height });
        setFailed(false);
        setLoading(false);
      } catch (error) {
        console.warn("[adjust-preview] 候选图加载失败", candidates[index], error);
        await load(index + 1);
      }
    };
    void load(0);
    return () => { canceled = true; };
  }, [fallbackUrl, localSourceUrl, open, rendererReady, retryToken, sourceUrl]);

  useEffect(() => {
    // 用 state 存节点而不是 ref：对话框内容是 portal 挂载的，ref 有可能拿到 null，
    // 那样这个 effect 就再也不会重跑，测量会一直是 0。
    if (!stage) return;
    const sync = () => setBox({ width: stage.clientWidth, height: stage.clientHeight });
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [stage]);

  const imageWidth = texture?.width || naturalWidth || 1;
  const imageHeight = texture?.height || naturalHeight || 1;
  const fitScale = box.width > 0 && box.height > 0
    ? Math.min(box.width / imageWidth, box.height / imageHeight)
    : 1;
  const zoom = view.scale > 0 && fitScale > 0 ? view.scale / fitScale : 1;

  // 视口尺寸变化（或图刚就位）时重新居中，缩放倍率保留。
  useEffect(() => {
    if (box.width <= 0 || box.height <= 0) return;
    const key = `${imageWidth}x${imageHeight}`;
    // 换图了（纹理刚就位、尺寸变了）就回到适应窗口；只是视口变小变大，则保留当前倍率。
    const imageChanged = viewImageRef.current !== key;
    viewImageRef.current = key;
    setView((current) => centeredView(
      imageChanged || current.scale <= 0
        ? fitScale
        : clamp(current.scale, fitScale * MIN_ZOOM, fitScale * MAX_ZOOM),
      box.width,
      box.height,
      imageWidth,
      imageHeight,
    ));
  }, [box.height, box.width, fitScale, imageHeight, imageWidth]);

  // 兜底：视口缩放一旦是 0/非法（比如被别处的状态重置冲掉了），只要容器和图片都就绪
  // 就自动补一次居中，避免预览一直空着。
  useEffect(() => {
    if (box.width <= 0 || box.height <= 0 || view.scale > 0) return;
    setView(centeredView(fitScale, box.width, box.height, imageWidth, imageHeight));
  }, [box.height, box.width, fitScale, imageHeight, imageWidth, view.scale]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !texture || box.width <= 0 || box.height <= 0) return;
    // 视口还没算出来时不要画：scale=0 会让着色器里的 screen/scale 变成无穷大，
    // 整屏都会被判成"图外"从而画成全透明。
    if (!(view.scale > 0)) {
      return;
    }
    const options = {
      adjustments,
      view: { scale: view.scale, offsetX: view.offsetX, offsetY: view.offsetY },
      cssWidth: box.width,
      cssHeight: box.height,
      devicePixelRatio: window.devicePixelRatio || 1,
      bypass: comparing,
      splitX: splitEnabled ? splitRatio : -1,
      // 清晰度的低通半径按原图长边自适应，渲染器再按预览缩放换算
      clarityAmount: (adjustments.clarity / 100) * IMAGE_ADJUSTMENT_CLARITY_MAX_AMOUNT,
      claritySigma: imageAdjustmentClaritySigma(Math.max(naturalWidth, naturalHeight)),
    };
    renderer.render(options);
    // 隔一帧再画一次：开场动画/布局稳定后合成器可能还要重绘，这一帧保证它拿到的是新画面。
    const frame = window.requestAnimationFrame(() => renderer.render(options));
    return () => window.cancelAnimationFrame(frame);
  }, [
    adjustments,
    box.height,
    box.width,
    comparing,
    naturalHeight,
    naturalWidth,
    rendererReady,
    splitEnabled,
    splitRatio,
    texture,
    view,
  ]);

  // 滚轮缩放：React 的 onWheel 在部分场景是被动监听，preventDefault 会失效，
  // 所以自己挂一个非被动的原生监听。
  useEffect(() => {
    if (!stage) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      // 相对画布左上角的位置，单位 CSS 像素
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const factor = Math.exp(-event.deltaY * 0.0015);
      setView((current) => {
        if (current.scale <= 0) return current;
        const nextScale = clamp(current.scale * factor, fitScale * MIN_ZOOM, fitScale * MAX_ZOOM);
        // 指针下的那个图像点保持不动：offset' = pointer 图像坐标 - pointer / scale'
        const imageX = current.offsetX + pointerX / current.scale;
        const imageY = current.offsetY + pointerY / current.scale;
        return clampView(
          {
            scale: nextScale,
            offsetX: imageX - pointerX / nextScale,
            offsetY: imageY - pointerY / nextScale,
          },
          box.width,
          box.height,
          imageWidth,
          imageHeight,
        );
      });
    };
    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [box.height, box.width, fitScale, imageHeight, imageWidth, stage]);

  const resetView = useCallback(() => {
    if (box.width <= 0 || box.height <= 0) return;
    setView(centeredView(fitScale, box.width, box.height, imageWidth, imageHeight));
  }, [box.height, box.width, fitScale, imageHeight, imageWidth]);

  const patchAdjustment = useCallback((key: ImageAdjustmentKey, value: number) => {
    setAdjustments((current) => normalizeImageAdjustments({ ...current, [key]: value }));
  }, []);

  const addPreset = useCallback(() => {
    const index = nextImagePresetIndex(presets, (value) => t("infiniteCanvas:imageAdjustPresetDefaultName", { index: value }));
    const name = t("infiniteCanvas:imageAdjustPresetDefaultName", { index });
    void createPreset(name, adjustments)
      .then((preset) => {
        setRenamingPresetId(preset.id);
        setPresetNameDraft(preset.name);
      })
      .catch((error) => {
        toast.error(t("infiniteCanvas:imageAdjustPresetSaveFailed", {
          message: String(error instanceof Error ? error.message : error),
        }));
      });
  }, [adjustments, createPreset, presets, t]);

  const commitPresetRename = useCallback((preset: ImagePresetRecord) => {
    setRenamingPresetId("");
    void renamePreset(preset.id, presetNameDraft).catch((error) => {
      toast.error(t("infiniteCanvas:imageAdjustPresetSaveFailed", {
        message: String(error instanceof Error ? error.message : error),
      }));
    });
  }, [presetNameDraft, renamePreset, t]);

  const deletePreset = useCallback((preset: ImagePresetRecord) => {
    void removePreset(preset.id).catch((error) => {
      toast.error(t("infiniteCanvas:imageAdjustPresetSaveFailed", {
        message: String(error instanceof Error ? error.message : error),
      }));
    });
  }, [removePreset, t]);

  const changed = !isDefaultImageAdjustments(adjustments);
  /** 组内某张图当前的参数：当前这张取实时值，其它取各自槽位。 */
  const adjustmentsForTarget = (key: string) => (
    key === activeTargetKey ? adjustments : adjustmentsByTarget[key] || DEFAULT_IMAGE_ADJUSTMENTS
  );
  const groupChanged = Boolean(targets?.length)
    && (targets || []).some((target) => !isDefaultImageAdjustments(adjustmentsForTarget(target.key)));
  /** 应用整组：把当前这张的参数复制到组内其它图片（只改参数，不落盘）。 */
  const applyAdjustmentsToGroup = useCallback(() => {
    if (!targets?.length) return;
    const next = { ...adjustmentsByTargetRef.current };
    targets.forEach((target) => {
      if (target.key === activeTargetKey) return;
      next[target.key] = adjustmentsRef.current;
    });
    adjustmentsByTargetRef.current = next;
    setAdjustmentsByTarget(next);
    toast.success(t("infiniteCanvas:imageAdjustGroupApplied"));
  }, [activeTargetKey, t, targets]);
  /** 保存整组：每张图存各自的参数，当前这张用实时值。 */
  const saveAdjustmentsGroup = useCallback(() => {
    if (!targets?.length) return;
    onSaveGroup?.(targets.map((target) => ({
      key: target.key,
      adjustments: target.key === activeTargetKey
        ? adjustmentsRef.current
        : adjustmentsByTargetRef.current[target.key] || DEFAULT_IMAGE_ADJUSTMENTS,
    })), localSourceUrl);
  }, [activeTargetKey, localSourceUrl, onSaveGroup, targets]);
  const resolution = naturalWidth > 0 && naturalHeight > 0 ? `${naturalWidth} × ${naturalHeight}` : "";
  const renderer = rendererRef.current;
  const glUnavailable = renderer ? !renderer.supported : false;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="rf-image-adjust sm:max-w-[min(1440px,calc(100vw-3rem))]">
        <DialogHeader>
          <DialogTitle>{t("infiniteCanvas:imageAdjustTitle")}</DialogTitle>
          {resolution ? <DialogDescription>{resolution}</DialogDescription> : null}
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rf-image-adjust__close"
              aria-label={t("common:actions.close")}
              title={t("common:actions.close")}
            >
              <X aria-hidden="true" />
            </Button>
          </DialogClose>
        </DialogHeader>

        <div className="rf-image-adjust__body">
          <div className="rf-image-adjust__stage">
          <div
            ref={setStage}
            className="rf-image-adjust__preview"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              // 按钮、输入框这些控件自己处理事件；否则 setPointerCapture 会把 click 吞掉。
              if ((event.target as HTMLElement).closest("button, input, .rf-image-adjust__overlay, .rf-image-adjust__split")) return;
              panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
              event.currentTarget.setPointerCapture(event.pointerId);
              event.currentTarget.classList.add("is-panning");
            }}
            onPointerMove={(event) => {
              const active = panRef.current;
              if (!active || active.pointerId !== event.pointerId) return;
              const deltaX = event.clientX - active.x;
              const deltaY = event.clientY - active.y;
              panRef.current = { pointerId: active.pointerId, x: event.clientX, y: event.clientY };
              // 鼠标往右拖，图就往右走：画布左上角对应的图像坐标要减小。
              setView((current) => clampView(
                {
                  scale: current.scale,
                  offsetX: current.offsetX - deltaX / current.scale,
                  offsetY: current.offsetY - deltaY / current.scale,
                },
                box.width,
                box.height,
                imageWidth,
                imageHeight,
              ));
            }}
            onPointerUp={(event) => {
              if (panRef.current?.pointerId !== event.pointerId) return;
              panRef.current = null;
              event.currentTarget.classList.remove("is-panning");
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onPointerCancel={(event) => {
              if (panRef.current?.pointerId !== event.pointerId) return;
              panRef.current = null;
              event.currentTarget.classList.remove("is-panning");
            }}
            onDoubleClick={resetView}
          >
            <canvas key={canvasGeneration} ref={setCanvasElement} className="rf-image-adjust__canvas" />

            {splitEnabled && texture ? (
              <div
                className="rf-image-adjust__split"
                style={{ left: `${splitRatio * 100}%` }}
                onPointerDown={(event) => {
                  // 别让分割线拖拽触发图片平移
                  event.stopPropagation();
                  splitDragRef.current = event.pointerId;
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (splitDragRef.current !== event.pointerId || !stage) return;
                  const rect = stage.getBoundingClientRect();
                  setSplitRatio(clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1));
                }}
                onPointerUp={(event) => {
                  if (splitDragRef.current !== event.pointerId) return;
                  splitDragRef.current = null;
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                }}
              >
                <span className="rf-image-adjust__split-grip" />
              </div>
            ) : null}

            <div className="rf-image-adjust__overlay">
              <span className="rf-image-adjust__zoom">{Math.round(zoom * 100)}%</span>
              <Button type="button" variant="ghost" size="icon-sm" title={t("infiniteCanvas:imageAdjustFit")} onClick={resetView}>
                <Maximize2 aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant={comparing ? "default" : "ghost"}
                size="sm"
                disabled={busy || !texture}
                onPointerDown={() => setComparing(true)}
                onPointerUp={() => setComparing(false)}
                onPointerLeave={() => setComparing(false)}
                onPointerCancel={() => setComparing(false)}
              >
                {t("infiniteCanvas:imageAdjustHoldOriginal")}
              </Button>
              <Button
                type="button"
                variant={splitEnabled ? "default" : "ghost"}
                size="sm"
                disabled={busy || !texture}
                aria-pressed={splitEnabled}
                onClick={() => setSplitEnabled((current) => !current)}
              >
                {t("infiniteCanvas:imageAdjustSplitCompare")}
              </Button>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="rf-image-adjust__reset"
              disabled={busy || !changed}
              aria-label={t("infiniteCanvas:imageAdjustReset")}
              title={t("infiniteCanvas:imageAdjustReset")}
              onClick={() => setAdjustments(DEFAULT_IMAGE_ADJUSTMENTS)}
            >
              <RotateCcw aria-hidden="true" />
            </Button>

            {loading || failed || glUnavailable ? (
              <button
                type="button"
                className={cn("rf-image-adjust__hint", failed && "is-error")}
                disabled={loading && !failed && !glUnavailable}
                onClick={() => {
                  if (!failed && !glUnavailable) return;
                  setFailed(false);
                  setLoading(true);
                  if (glUnavailable) {
                    glRetryRef.current = 0;
                    setCanvasElement(null);
                    setCanvasGeneration((value) => value + 1);
                  }
                  setRetryToken((value) => value + 1);
                }}
              >
                {glUnavailable
                  ? t("infiniteCanvas:imageAdjustWebglUnavailable")
                  : failed
                    ? t("infiniteCanvas:imageAdjustPreviewFailed")
                    : t("infiniteCanvas:imageAdjustRenderingPreview")}
              </button>
            ) : null}
          </div>

          {targets?.length ? (
            <div
              className="rf-image-adjust__targets"
              role="list"
              aria-label={t("infiniteCanvas:imageAdjustGroupTargets")}
            >
              {targets.map((target, index) => (
                <ImageAdjustTargetButton
                  key={target.key}
                  target={target}
                  index={index}
                  active={target.key === activeTargetKey}
                  disabled={busy || savingGroup}
                  onSelect={onSelectTarget}
                />
              ))}
            </div>
          ) : null}
          </div>

          <div className="rf-image-adjust__side">
            <NativeTabs
              items={[
                { value: "presets", label: t("infiniteCanvas:imageAdjustTabPresets"), icon: Sparkles },
                { value: "adjust", label: t("infiniteCanvas:imageAdjustTabAdjust"), icon: SlidersHorizontal },
              ]}
              value={tab}
              onChange={setTab}
              ariaLabel={t("infiniteCanvas:imageAdjustTitle")}
              className="rf-image-adjust__tabs"
            />

            {tab === "presets" ? (
              <div className="rf-image-adjust__presets">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={addPreset}
                >
                  <Plus aria-hidden="true" />
                  {t("infiniteCanvas:imageAdjustPresetAdd")}
                </Button>
                <AppScrollArea className="rf-image-adjust__preset-list" scrollbars="vertical">
                  <DraggableList
                    items={presets}
                    getId={(preset) => preset.id}
                    disabled={busy}
                    onReorder={(next) => {
                      void savePresets(next).catch((error) => {
                        toast.error(t("infiniteCanvas:imageAdjustPresetSaveFailed", {
                          message: String(error instanceof Error ? error.message : error),
                        }));
                      });
                    }}
                    empty={<p className="rf-image-adjust__presets-empty">{t("infiniteCanvas:imageAdjustPresetsEmpty")}</p>}
                    renderItem={(preset, { dragHandleProps, isDragging }) => (
                      <div className={cn("rf-image-adjust__preset-row", isDragging && "is-dragging")}>
                        <span
                          className="rf-image-adjust__preset-grip"
                          title={t("infiniteCanvas:imageAdjustPresetReorder")}
                          {...dragHandleProps}
                        >
                          <GripVertical aria-hidden="true" />
                        </span>
                        {renamingPresetId === preset.id ? (
                          <Input
                            data-slot="input-group-control"
                            autoFocus
                            className="h-6 rounded-none border-0 bg-transparent p-0 text-xs shadow-none focus-visible:ring-0 dark:bg-transparent"
                            value={presetNameDraft}
                            onChange={(event) => setPresetNameDraft(event.currentTarget.value)}
                            onBlur={() => commitPresetRename(preset)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") event.currentTarget.blur();
                              else if (event.key === "Escape") {
                                setPresetNameDraft(preset.name);
                                setRenamingPresetId("");
                                event.currentTarget.blur();
                              }
                            }}
                          />
                        ) : (
                          <button
                            type="button"
                            className="rf-image-adjust__preset-name"
                            title={t("infiniteCanvas:imageAdjustPresetApplyHint")}
                            onClick={() => setAdjustments(normalizeImageAdjustments(preset.adjustments))}
                            onDoubleClick={() => {
                              setPresetNameDraft(preset.name);
                              setRenamingPresetId(preset.id);
                            }}
                          >
                            {preset.name || t("infiniteCanvas:imageAdjustPresetUnnamed")}
                          </button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy}
                          aria-label={t("infiniteCanvas:imageAdjustPresetDelete")}
                          title={t("infiniteCanvas:imageAdjustPresetDelete")}
                          onClick={() => deletePreset(preset)}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  />
                </AppScrollArea>
              </div>
            ) : (
              <AppScrollArea className="rf-image-adjust__controls" scrollbars="vertical">
                <div className="rf-image-adjust__controls-list">
                  {IMAGE_ADJUSTMENT_CONTROLS.map((control) => {
                    const value = adjustments[control.key];
                    const controlLabel = t(`infiniteCanvas:${CONTROL_LABEL_KEYS[control.key]}`);
                    return (
                      <div key={control.key} className="rf-image-adjust__row">
                        <span className="rf-image-adjust__label" title={controlLabel}>{controlLabel}</span>
                        <div className="rf-image-adjust__control">
                          <div
                            className="rf-image-adjust__slider-wrap"
                            // 双击滑条 = 把这一项恢复默认
                            onDoubleClick={() => patchAdjustment(control.key, control.neutral)}
                          >
                            <Slider
                              value={[value]}
                              min={control.min}
                              max={control.max}
                              step={control.step}
                              disabled={busy}
                              onValueChange={([next]) => patchAdjustment(control.key, next)}
                              thumbLabel={controlLabel}
                            />
                            {/* 初始值刻度：让用户知道滑到哪里是"没改" */}
                            <span
                              className="rf-image-adjust__tick"
                              style={{ left: `${((control.neutral - control.min) / (control.max - control.min)) * 100}%` }}
                              aria-hidden="true"
                            />
                          </div>
                          <AdjustmentValueInput
                            value={value}
                            control={control}
                            disabled={busy}
                            onCommit={(next) => patchAdjustment(control.key, next)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </AppScrollArea>
            )}

            {/* 按钮跟调节区同属右栏：左栏预览因此能吃满面板高度。 */}
            <div className="rf-image-adjust__actions">
              {groupMode ? (
                <>
                  <Button
                    type="button"
                    variant="default"
                    disabled={busy || !changed || !localSourceUrl}
                    onClick={() => onApply(adjustments, localSourceUrl, "overwrite")}
                  >
                    {busy && !savingGroup ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
                    {busy && !savingGroup ? t("infiniteCanvas:imageAdjustApplying") : t("infiniteCanvas:imageAdjustApply")}
                  </Button>
                  {/* 组入口固定覆盖原图，不再询问"覆盖 / 新建节点"。 */}
                  {(targets?.length || 0) > 1 ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy || !localSourceUrl}
                        title={t("infiniteCanvas:imageAdjustApplyGroupHint")}
                        onClick={applyAdjustmentsToGroup}
                      >
                        {t("infiniteCanvas:imageAdjustApplyGroup")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy || !localSourceUrl || !groupChanged}
                        onClick={saveAdjustmentsGroup}
                      >
                        {savingGroup ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
                        {groupSaveProgress
                          ? t("infiniteCanvas:imageAdjustSavingGroup", {
                            done: groupSaveProgress.done,
                            total: groupSaveProgress.total,
                          })
                          : t("infiniteCanvas:imageAdjustSaveGroup")}
                      </Button>
                    </>
                  ) : null}
                </>
              ) : (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="default" disabled={busy || !changed || !localSourceUrl}>
                      {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}
                      {busy ? t("infiniteCanvas:imageAdjustApplying") : t("infiniteCanvas:imageAdjustApply")}
                      <ChevronDown aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onApply(adjustments, localSourceUrl, "overwrite")}>
                      {t("infiniteCanvas:imageAdjustApplyOverwrite")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onApply(adjustments, localSourceUrl, "newNode")}>
                      {t("infiniteCanvas:imageAdjustApplyNewNode")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
