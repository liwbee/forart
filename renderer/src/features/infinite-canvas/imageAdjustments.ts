/**
 * 图片调整参数的唯一入口。
 *
 * 预览走 CSS filter（浏览器 GPU 合成），导出走主进程 sharp，两条路必须算出同一个
 * 结果，所以这里只定义"参数是什么意思"，具体矩阵和公式在
 * electron/main/modules/image-adjustments.cjs 里实现，两边一一对应：
 *
 *   CSS:   saturate() → grayscale() → hue-rotate() → brightness() → contrast()
 *   sharp: blur → recomb(3×3 色彩矩阵) → linear(a · x + b) → 噪点合成
 *
 * 顺序不是随便排的：sharp 一条 pipeline 内部的操作顺序是固定的（blur 先于 recomb，
 * recomb 先于 linear，与调用顺序无关），CSS 的 filter 列表则是从左到右依次作用，
 * 两边对齐才不会出现"预览和成片不是一个颜色"。
 *
 * 模糊和噪点不在这条 CSS 字符串里：它们跑在预览的画布上
 * （见 imageAdjustPreviewRenderer.ts），因为 CSS 的 blur 会让图像外沿透明扩散，
 * 而且没法控制噪点。
 */

export interface NativeCanvasImageAdjustments {
  /** 亮度倍数，1 为原图。 */
  brightness: number;
  /** 对比度倍数，1 为原图。 */
  contrast: number;
  /** 饱和度倍数，1 为原图。 */
  saturation: number;
  /** 灰度混合比例，0 为原图，1 为完全灰度。 */
  grayscale: number;
  /** 色相旋转角度，单位度。 */
  hue: number;
  /**
   * 清晰度：大半径的局部对比增强（非锐化掩模），0 为不加强。
   * 强度 0-100 映射到 0-1.5 倍，半径按图像尺寸自适应（见 imageAdjustmentClaritySigma）。
   */
  clarity: number;
  /** 高斯模糊半径，以原图像素为单位，0 为不模糊。 */
  blur: number;
  /** 胶片颗粒强度（覆盖式混合，中间调最明显），0 为不加。 */
  noise: number;
  /**
   * 杂色强度，等价于 Photoshop「添加杂色 · 高斯分布」：
   * 每个通道各取一个以 0 为中心的高斯随机数加到像素上再钳位（非单色，会出彩色斑点）。
   */
  speckle: number;
}

export type ImageAdjustmentKey = keyof NativeCanvasImageAdjustments;
type ImageAdjustmentNumericKey = ImageAdjustmentKey;

export const DEFAULT_IMAGE_ADJUSTMENTS: NativeCanvasImageAdjustments = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  grayscale: 0,
  hue: 0,
  clarity: 0,
  blur: 0,
  noise: 0,
  speckle: 0,
};

/**
 * 颗粒/杂色强度 100 对应的标准差（0-255 量级）。
 * 主进程 image-adjustments.cjs 里有同名常量，改这里记得同步。
 */
export const IMAGE_ADJUSTMENT_NOISE_MAX_SIGMA = 24;
/**
 * 杂色（PS「添加杂色」）的上限，比颗粒大一档：
 * PS 的「数量」拉满时噪声相当重，24 太弱。主进程 image-adjustments.cjs 里有同名常量。
 */
export const IMAGE_ADJUSTMENT_SPECKLE_MAX_SIGMA = 48;

/** 清晰度的强度上限：0-100 映射到 0-1.5 倍。主进程有同名常量。 */
export const IMAGE_ADJUSTMENT_CLARITY_MAX_AMOUNT = 1.5;

/**
 * 清晰度的模糊半径（以原图像素为单位），按图片长边自适应：
 * 小图用小半径、大图用大半径，观感才一致。渲染进程和主进程必须用同一个公式。
 * 上限 10 是因为 sharp 的 sharpen sigma 最大只接受 10（关系到预览/导出一致性）。
 */
export function imageAdjustmentClaritySigma(longEdge: number) {
  const size = Number.isFinite(longEdge) && longEdge > 0 ? longEdge : 1000;
  return Math.min(10, Math.max(2, Math.round(size * 0.004)));
}

export interface ImageAdjustmentControl {
  key: ImageAdjustmentNumericKey;
  min: number;
  max: number;
  step: number;
  /** 中立值，用来判断这一项是否被改动过。 */
  neutral: number;
}

export const IMAGE_ADJUSTMENT_CONTROLS: readonly ImageAdjustmentControl[] = [
  { key: "brightness", min: 0.2, max: 2, step: 0.01, neutral: 1 },
  { key: "contrast", min: 0.2, max: 2, step: 0.01, neutral: 1 },
  { key: "saturation", min: 0, max: 2, step: 0.01, neutral: 1 },
  { key: "grayscale", min: 0, max: 1, step: 0.01, neutral: 0 },
  { key: "hue", min: -180, max: 180, step: 1, neutral: 0 },
  { key: "clarity", min: 0, max: 100, step: 1, neutral: 0 },
  { key: "blur", min: 0, max: 40, step: 0.5, neutral: 0 },
  { key: "noise", min: 0, max: 100, step: 1, neutral: 0 },
  // 杂色对齐 Photoshop「添加杂色」的数量刻度：0-400%
  { key: "speckle", min: 0, max: 400, step: 1, neutral: 0 },
];

const CONTROL_BY_KEY = new Map(IMAGE_ADJUSTMENT_CONTROLS.map((control) => [control.key, control]));

/** 滑块步长是 0.01，比这更接近中立值的都直接归位，避免浮点噪声拼出恒等变换。 */
const NEUTRAL_EPSILON = 1e-4;

function clampControl(key: ImageAdjustmentNumericKey, value: unknown) {
  const control = CONTROL_BY_KEY.get(key);
  const fallback = DEFAULT_IMAGE_ADJUSTMENTS[key];
  const numeric = Number(value);
  if (!control || !Number.isFinite(numeric)) return fallback;
  const clamped = Math.min(control.max, Math.max(control.min, numeric));
  return Math.abs(clamped - control.neutral) < NEUTRAL_EPSILON ? control.neutral : clamped;
}

/** 把来路不明的参数（存档、IPC、旧数据）收拢成一份合法参数。 */
export function normalizeImageAdjustments(
  value: Partial<NativeCanvasImageAdjustments> | null | undefined,
): NativeCanvasImageAdjustments {
  const source = value && typeof value === "object" ? value : {};
  return {
    brightness: clampControl("brightness", source.brightness ?? DEFAULT_IMAGE_ADJUSTMENTS.brightness),
    contrast: clampControl("contrast", source.contrast ?? DEFAULT_IMAGE_ADJUSTMENTS.contrast),
    saturation: clampControl("saturation", source.saturation ?? DEFAULT_IMAGE_ADJUSTMENTS.saturation),
    grayscale: clampControl("grayscale", source.grayscale ?? DEFAULT_IMAGE_ADJUSTMENTS.grayscale),
    hue: clampControl("hue", source.hue ?? DEFAULT_IMAGE_ADJUSTMENTS.hue),
    clarity: clampControl("clarity", source.clarity ?? DEFAULT_IMAGE_ADJUSTMENTS.clarity),
    blur: clampControl("blur", source.blur ?? DEFAULT_IMAGE_ADJUSTMENTS.blur),
    noise: clampControl("noise", source.noise ?? DEFAULT_IMAGE_ADJUSTMENTS.noise),
    speckle: clampControl("speckle", source.speckle ?? DEFAULT_IMAGE_ADJUSTMENTS.speckle),
  };
}

/** 参数是否等于"什么都没改"，用来决定要不要真的渲染一张新图。 */
export function isDefaultImageAdjustments(value: Partial<NativeCanvasImageAdjustments> | null | undefined) {
  const adjustments = normalizeImageAdjustments(value);
  return IMAGE_ADJUSTMENT_CONTROLS.every((control) => (
    Math.abs(adjustments[control.key] - control.neutral) < 1e-6
  ));
}

/**
 * 预览用的 CSS filter。
 *
 * 只管颜色：模糊和噪点由画布渲染层负责（见 imageAdjustPreviewRenderer.ts）。
 */
export function imageAdjustmentCssFilter(
  value: Partial<NativeCanvasImageAdjustments> | null | undefined,
): string {
  const adjustments = normalizeImageAdjustments(value);
  const parts: string[] = [];

  if (adjustments.saturation !== 1) parts.push(`saturate(${adjustments.saturation.toFixed(4)})`);
  if (adjustments.grayscale > 0) parts.push(`grayscale(${adjustments.grayscale.toFixed(4)})`);
  if (adjustments.hue !== 0) parts.push(`hue-rotate(${adjustments.hue.toFixed(2)}deg)`);
  if (adjustments.brightness !== 1) parts.push(`brightness(${adjustments.brightness.toFixed(4)})`);
  if (adjustments.contrast !== 1) parts.push(`contrast(${adjustments.contrast.toFixed(4)})`);

  return parts.length ? parts.join(" ") : "none";
}
