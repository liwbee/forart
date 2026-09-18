/**
 * 图片调整的像素数学。
 *
 * 预览跑在渲染进程的 CSS filter 上，导出跑在这里的 sharp 上，两边必须得出同一个
 * 结果，所以这里的每个公式都严格对着 CSS Filter Effects 的规范写：
 *
 *   saturate(s)   = feColorMatrix type="saturate"  value=s
 *   grayscale(g)  = feColorMatrix type="saturate"  value=1-g（规范里灰度就是它）
 *   hue-rotate(θ) = feColorMatrix type="hueRotate" value=θ
 *   brightness(b) / contrast(c) = feComponentTransfer 的线性变换
 *   blur(r)       = feGaussianBlur stdDeviation=r
 *
 * 顺序也要对齐：sharp 一条 pipeline 内部的操作顺序是固定的（blur → recomb → linear，
 * 与调用顺序无关），CSS 的 filter 列表从左到右依次作用，渲染进程那边就是按这个顺序
 * 拼字符串的。改这里的时候记得同步 renderer/src/features/infinite-canvas/imageAdjustments.ts。
 */

/** feColorMatrix type="saturate" 用的亮度权重。 */
const SATURATE_WEIGHTS = [0.213, 0.715, 0.072];
/** feColorMatrix 灰度矩阵用的亮度权重，和 saturate 的系数有极小的差别。 */
const GRAYSCALE_WEIGHTS = [0.2126, 0.7152, 0.0722];
/** 8 位图上 contrast(c) 的偏移量基准：(1-c) 在 0-1 里的 0.5 换算成 0-255。 */
const CONTRAST_MIDPOINT = 127.5;

const DEFAULTS = {
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

const LIMITS = {
  brightness: [0.2, 2],
  contrast: [0.2, 2],
  saturation: [0, 2],
  grayscale: [0, 1],
  hue: [-180, 180],
  clarity: [0, 100],
  blur: [0, 40],
  noise: [0, 100],
  speckle: [0, 400],
};

/**
 * 颗粒/杂色强度 100 对应的标准差（0-255 量级）。
 * 渲染进程 imageAdjustments.ts 里有同名常量，改这里记得同步。
 */
const NOISE_MAX_SIGMA = 24;
/**
 * 杂色（Photoshop「添加杂色」）的上限要更大：PS 的「数量」拉满时噪声相当重，24 太弱。
 */
const SPECKLE_MAX_SIGMA = 48;
/** 清晰度的强度上限：0-100 映射到 0-1.5 倍。渲染进程 imageAdjustments.ts 有同名常量。 */
const CLARITY_MAX_AMOUNT = 1.5;

/**
 * 清晰度的模糊半径（以原图像素为单位），按图片长边自适应。
 * 必须和渲染进程 imageAdjustmentClaritySigma 是同一个公式。
 * 上限 10 是 sharp 的 sharpen sigma 硬限制（关系到预览/导出一致性）。
 */
function claritySigma(longEdge) {
  const size = Number.isFinite(longEdge) && longEdge > 0 ? longEdge : 1000;
  return Math.min(10, Math.max(2, Math.round(size * 0.004)));
}

function normalizeImageAdjustments(value) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {};
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const numeric = Number(source[key]);
    const [min, max] = LIMITS[key];
    if (!Number.isFinite(numeric)) {
      result[key] = fallback;
      continue;
    }
    const clamped = Math.min(max, Math.max(min, numeric));
    // 和渲染进程一样：贴近中立值的浮点噪声直接归位，避免拼出恒等变换。
    result[key] = Math.abs(clamped - fallback) < 1e-4 ? fallback : clamped;
  }
  return result;
}

function identityMatrix() {
  return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
}

function multiplyMatrix3(left, right) {
  const result = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      let sum = 0;
      for (let index = 0; index < 3; index += 1) sum += left[row][index] * right[index][column];
      result[row][column] = sum;
    }
  }
  return result;
}

function saturateMatrix(saturation) {
  const rest = 1 - saturation;
  return [0, 1, 2].map((row) => SATURATE_WEIGHTS.map((weight, column) => (
    rest * weight + (row === column ? saturation : 0)
  )));
}

function grayscaleMatrix(amount) {
  return [0, 1, 2].map((row) => GRAYSCALE_WEIGHTS.map((weight, column) => (
    (1 - amount) * (row === column ? 1 : 0) + amount * weight
  )));
}

function hueRotationMatrix(degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [
    [0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928],
    [0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.140, 0.072 - cos * 0.072 - sin * 0.283],
    [0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072],
  ];
}

function isIdentityMatrix(matrix) {
  const identity = identityMatrix();
  return matrix.every((row, rowIndex) => row.every((value, columnIndex) => (
    Math.abs(value - identity[rowIndex][columnIndex]) < 1e-9
  )));
}

/**
 * 把调整参数翻译成 sharp 需要的三个操作。
 * 返回 null 表示这一档不需要做任何事。
 *
 * scale 是"输出图相对原图的比例"（预览会缩到更小的尺寸）：模糊半径和噪点标准差
 * 都是以原图像素为单位给的，缩图输出时要同比缩放，否则预览会比成片糊得多、
 * 颗粒也粗得多。
 */
function imageAdjustmentPlan(value, { scale = 1, longEdge = 0 } = {}) {
  const adjustments = normalizeImageAdjustments(value);
  const sizeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

  // 色彩矩阵：hue-rotate ∘ grayscale ∘ saturate，和 CSS 里从左到右的顺序一致。
  let matrix = identityMatrix();
  if (adjustments.saturation !== 1) matrix = multiplyMatrix3(matrix, saturateMatrix(adjustments.saturation));
  if (adjustments.grayscale > 0) matrix = multiplyMatrix3(matrix, grayscaleMatrix(adjustments.grayscale));
  if (adjustments.hue !== 0) matrix = multiplyMatrix3(matrix, hueRotationMatrix(adjustments.hue));

  // 亮度是纯乘、对比度是"乘 + 偏移"，两级合成一次 linear：out = (c·b)·x + 127.5·(1-c)。
  const multiplier = adjustments.contrast * adjustments.brightness;
  const offset = CONTRAST_MIDPOINT * (1 - adjustments.contrast);
  return {
    adjustments,
    // CSS 的 blur(r) 就是 feGaussianBlur 的 stdDeviation，libvips 的 blur 也是标准差。
    blurSigma: adjustments.blur * sizeScale,
    /** 覆盖式颗粒：走 libvips 的 overlay 合成。 */
    noiseSigma: (adjustments.noise / 100) * NOISE_MAX_SIGMA * sizeScale,
    /** 加性杂色：直接改像素，逐通道独立（PS 添加杂色·高斯）。 */
    speckleSigma: (adjustments.speckle / 100) * SPECKLE_MAX_SIGMA * sizeScale,
    /**
     * 清晰度：半径按图片长边自适应。注意缩图输出（预览）时半径不跟着缩，
     * 因为清晰度是对"当前这张图"做局部对比，预览缩图后本来就该用更小的半径，
     * 这里跟着 sizeScale 一起缩，保证预览和成片的观感一致。
     */
    clarityAmount: (adjustments.clarity / 100) * CLARITY_MAX_AMOUNT,
    claritySigma: claritySigma(longEdge) * sizeScale,
    recombMatrix: isIdentityMatrix(matrix) ? null : matrix,
    linear: multiplier === 1 && offset === 0 ? null : { multiplier, offset },
  };
}

/** 把调整应用到一条 sharp pipeline 上（顺序由 sharp 自己固定，这里只管挂操作）。 */
function applyImageAdjustments(pipeline, value, options) {
  const plan = imageAdjustmentPlan(value, options);
  if (plan.blurSigma > 0) pipeline.blur(plan.blurSigma);
  if (plan.recombMatrix) pipeline.recomb(plan.recombMatrix);
  if (plan.linear) pipeline.linear(plan.linear.multiplier, plan.linear.offset);
  if (plan.clarityAmount > 0) {
    // libvips 的 sharpen 就是"高斯模糊 + 非锐化掩模"，作用在 LAB 的 L 通道上，
    // 正好等价于清晰度：只加强局部对比、不动色彩（x1=0 表示不做平坦/边缘区分）。
    pipeline.sharpen({
      sigma: plan.claritySigma,
      m1: plan.clarityAmount,
      m2: plan.clarityAmount,
      x1: 0,
    });
  }
  return pipeline;
}

module.exports = {
  DEFAULTS,
  LIMITS,
  applyImageAdjustments,
  imageAdjustmentPlan,
  normalizeImageAdjustments,
};
