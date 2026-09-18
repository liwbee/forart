/**
 * 调整预览的 WebGL2 渲染器。
 *
 * 预览直接拿**原图**当纹理，缩放平移都在着色器里做，所以不管放大多少倍看到的都是
 * 原图的真实像素（放大是放大采样，缩小走 mipmap），不存在"渲染尺寸上限"这回事。
 *
 * 运算顺序和主进程 sharp 保持一致：模糊 → 颜色矩阵(recomb) → 亮度/对比度(linear)
 * → 噪点合成。颜色那两步是同一套矩阵和公式，能和导出逐位对上。
 */

import {
  normalizeImageAdjustments,
  IMAGE_ADJUSTMENT_NOISE_MAX_SIGMA,
  IMAGE_ADJUSTMENT_SPECKLE_MAX_SIGMA,
  type NativeCanvasImageAdjustments,
} from "./imageAdjustments";

export interface AdjustPreviewView {
  /** 屏幕 1 像素对应多少图像像素的倒数（屏幕 px / 图像 px）。 */
  scale: number;
  /** 画布左上角在图像坐标里的位置。 */
  offsetX: number;
  offsetY: number;
}

export interface AdjustPreviewRenderOptions {
  adjustments: Partial<NativeCanvasImageAdjustments> | null | undefined;
  view: AdjustPreviewView;
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio: number;
  /** 按住看原图：跳过所有调整。 */
  bypass?: boolean;
  /** 分割对比线位置（0..1）；不传或 < 0 表示不分割。 */
  splitX?: number;
  /** 清晰度强度（0-1.5），由调用方按参数换算。 */
  clarityAmount?: number;
  /** 清晰度低通半径，以原图像素为单位。 */
  claritySigma?: number;
}

export interface ImageAdjustPreviewRenderer {
  readonly supported: boolean;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly maxTextureSize: number;
  /** 上传原图；超过纹理上限时会等比缩到上限。 */
  setImage(source: TexImageSource, width: number, height: number): void;
  render(options: AdjustPreviewRenderOptions): void;
  dispose(): void;
}

/** 可分离高斯：12 个采样点覆盖 ±3σ，权重只跟归一化位置有关，所以可以写死。 */
const BLUR_TAPS = 12;
const BLUR_WEIGHTS = Array.from({ length: BLUR_TAPS + 1 }, (_, index) => {
  const position = (index * 3) / BLUR_TAPS;
  return Math.exp(-0.5 * position * position);
});

const VERTEX_SHADER = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const BLUR_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uImage;
uniform vec2 uImageSize;
uniform vec2 uCanvasSize;
uniform vec2 uOffset;
uniform float uScale;
uniform vec2 uStep;      // 屏幕像素单位的采样间隔
uniform float uWeights[${BLUR_TAPS + 1}];
/** 1 = 输入是屏幕空间的中间帧（第二趟），0 = 输入是原图纹理（第一趟）。 */
uniform float uSourceIsScreen;
out vec4 outColor;

vec4 sampleImage(vec2 screen) {
  // 原图是图像空间（要过视口变换），中间帧已经是屏幕空间（直接按画布归一化，
  // 注意 FBO 的行序和 gl_FragCoord 相反）。搞混的话画面会被二次变换，看起来像缩放拉伸。
  vec2 uv = uSourceIsScreen > 0.5
    ? screen / uCanvasSize
    : (uOffset + screen / uScale) / uImageSize;
  return texture(uImage, uv);
}

void main() {
  vec2 screen = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
  float total = uWeights[0];
  vec4 sum = sampleImage(screen) * uWeights[0];
  for (int i = 1; i <= ${BLUR_TAPS}; i++) {
    float weight = uWeights[i];
    total += weight * 2.0;
    sum += sampleImage(screen + uStep * float(i)) * weight;
    sum += sampleImage(screen - uStep * float(i)) * weight;
  }
  outColor = sum / total;
}`;

const FINAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D uImage;
/** 始终是未处理的原图，用来做分割对比的"原图"那半边。 */
uniform sampler2D uImageRaw;
/** 清晰度用的低通层（同样尺寸的模糊结果）。 */
uniform sampler2D uClarityLow;
uniform vec2 uImageSize;
uniform vec2 uCanvasSize;
uniform vec2 uOffset;
uniform float uScale;
uniform mat3 uColorMatrix;
uniform float uLinearA;
uniform float uLinearB;
/** 胶片颗粒强度（覆盖式混合）。 */
uniform float uNoiseSigma;
/** 杂色强度（加性、逐通道独立，等价 PS 添加杂色·高斯）。 */
uniform float uSpeckleSigma;
/** 清晰度强度（0-1.5）。 */
uniform float uClarityAmount;
/** 1 = 采样模糊层（屏幕空间），0 = 直接采样原图（图像空间）。 */
uniform float uUseBlurred;
/** 分割对比线位置（0..1，画布宽度比例）；< 0 表示不做分割。 */
uniform float uSplitX;
out vec4 outColor;

/**
 * 32 位整数位混合哈希。
 *
 * 常见的 fract(p * k) 那种哈希在整数格点上质量很差，放大成逐像素看会露出网格状的
 * 规律（libvips 的噪声没有这个问题，两边一对比就很明显）。这里用位运算做雪崩混合。
 */
uint hashBits(uint value) {
  value ^= value >> 16;
  value *= 0x7feb352du;
  value ^= value >> 15;
  value *= 0x846ca68bu;
  value ^= value >> 16;
  return value;
}

float hashCell(ivec2 cell, uint seed) {
  uint mixed = uint(cell.x) * 0x9e3779b1u ^ uint(cell.y) * 0x85ebca6bu ^ seed;
  return float(hashBits(mixed)) * (1.0 / 4294967296.0);
}

/** 三个独立均匀分布相加近似高斯；方差 3/12，乘 2 归一化到单位标准差。 */
float gaussianNoise(ivec2 cell, uint seed) {
  float a = hashCell(cell, seed);
  float b = hashCell(cell, seed + 0x9e3779b9u);
  float c = hashCell(cell, seed + 0x85ebca6bu);
  return (a + b + c - 1.5) * 2.0;
}

float overlayChannel(float base, float blend) {
  return base < 0.5
    ? 2.0 * base * blend
    : 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
}

void main() {
  vec2 screen = vec2(gl_FragCoord.x, uCanvasSize.y - gl_FragCoord.y);
  vec2 imagePos = uOffset + screen / uScale;
  vec2 imageUv = imagePos / uImageSize;
  // 图外不画。否则采样会被 CLAMP_TO_EDGE 拉住，边缘像素被拉伸铺满整个视口。
  if (imageUv.x < 0.0 || imageUv.x > 1.0 || imageUv.y < 0.0 || imageUv.y > 1.0) {
    outColor = vec4(0.0);
    return;
  }
  // 分割对比：线的右侧显示原图（未经任何处理、也没模糊）。
  if (uSplitX >= 0.0 && screen.x >= uSplitX * uCanvasSize.x) {
    outColor = texture(uImageRaw, imageUv);
    return;
  }
  // 模糊层是"屏幕空间"的一张图（和当前视口逐像素对应），原图则要按视口矩阵换算。
  // 注意 FBO 的行序和 gl_FragCoord 是反的，这里按 screen 归一化坐标取。
  vec2 screenUv = screen / uCanvasSize;
  vec4 sampled = uUseBlurred > 0.5
    ? texture(uImage, screenUv)
    : texture(uImage, imageUv);

  // 颜色矩阵：和 sharp 的 recomb 用同一组系数，逐位对得上。
  vec3 color = clamp(uColorMatrix * sampled.rgb, 0.0, 1.0);
  color = clamp(color * uLinearA + uLinearB, 0.0, 1.0);

  // 清晰度：只把亮度上的"原图 - 低通"差值加回去，不动色彩（避免彩边）。
  // 上下限和 libvips 的 y2/y3（最大提亮 10、最大压暗 20）对齐。
  if (uClarityAmount > 0.0) {
    vec3 low = texture(uClarityLow, screenUv).rgb;
    float delta = dot(sampled.rgb - low, vec3(0.2126, 0.7152, 0.0722));
    color = clamp(color + clamp(delta * uClarityAmount, -20.0 / 255.0, 10.0 / 255.0), 0.0, 1.0);
  }

  // 颗粒/杂色都锚在图像坐标上（平移缩放时跟着图走，不是贴在屏幕上）。
  // 缩小显示时把格子放大、幅度衰减，等价于成片缩小后的平均效果，也避免闪烁。
  float lattice = max(1.0, 1.0 / max(uScale, 1e-4));
  ivec2 cell = ivec2(floor(imagePos / lattice));
  float shrink = min(uScale, 1.0);

  if (uNoiseSigma > 0.0) {
    // 覆盖式颗粒：中间调最明显、两端弱，像胶片。
    float blend = 0.5 + gaussianNoise(cell, 0u) * uNoiseSigma * shrink;
    color = vec3(
      overlayChannel(color.r, blend),
      overlayChannel(color.g, blend),
      overlayChannel(color.b, blend)
    );
  }

  if (uSpeckleSigma > 0.0) {
    // 加性杂色（PS 添加杂色·高斯，非单色）：三个通道各取独立随机数，再钳位。
    // 对称所以暗部会出现更暗的斑点、亮部出现更亮的斑点。
    float amplitude = uSpeckleSigma * shrink;
    vec3 speckle = vec3(
      gaussianNoise(cell, 1u),
      gaussianNoise(cell, 2u),
      gaussianNoise(cell, 3u)
    );
    color = clamp(color + speckle * amplitude, 0.0, 1.0);
  }

  outColor = vec4(clamp(color, 0.0, 1.0), sampled.a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("[adjust-preview] shader 编译失败:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, fragmentSource: string) {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "aPosition");
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("[adjust-preview] program 链接失败:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function colorMatrixFor(adjustments: NativeCanvasImageAdjustments) {
  // 和主进程 image-adjustments.cjs 用同一组权重，保证颜色运算逐位一致。
  const saturateWeights = [0.213, 0.715, 0.072];
  const grayscaleWeights = [0.2126, 0.7152, 0.0722];
  const multiply = (left: number[][], right: number[][]) => left.map((row) => [0, 1, 2].map((column) => (
    row[0] * right[0][column] + row[1] * right[1][column] + row[2] * right[2][column]
  )));
  let matrix = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  if (adjustments.saturation !== 1) {
    const rest = 1 - adjustments.saturation;
    matrix = multiply(matrix, [0, 1, 2].map((row) => saturateWeights.map((weight, column) => (
      rest * weight + (row === column ? adjustments.saturation : 0)
    ))));
  }
  if (adjustments.grayscale > 0) {
    matrix = multiply(matrix, [0, 1, 2].map((row) => grayscaleWeights.map((weight, column) => (
      (1 - adjustments.grayscale) * (row === column ? 1 : 0) + adjustments.grayscale * weight
    ))));
  }
  if (adjustments.hue !== 0) {
    const radians = (adjustments.hue * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    matrix = multiply(matrix, [
      [0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928],
      [0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.140, 0.072 - cos * 0.072 - sin * 0.283],
      [0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072],
    ]);
  }
  // 列主序：GLSL 的 mat3 构造函数按列取值
  return new Float32Array([
    matrix[0][0], matrix[1][0], matrix[2][0],
    matrix[0][1], matrix[1][1], matrix[2][1],
    matrix[0][2], matrix[1][2], matrix[2][2],
  ]);
}

export function createImageAdjustPreviewRenderer(canvas: HTMLCanvasElement): ImageAdjustPreviewRenderer {
  const context = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    // 必须保留绘制缓冲：第一次打开时绘制发生在对话框的开场动画还没结束的时候，
    // 动画一结束合成器要重绘这块画布，不保留的话内容已经被丢弃，画面就是空白
    // （表现就是"第一次打开空白，点几下对比按钮又出来"）。
    preserveDrawingBuffer: true,
  });

  if (!context) {
    return {
      supported: false,
      imageWidth: 0,
      imageHeight: 0,
      maxTextureSize: 0,
      setImage: () => undefined,
      render: () => undefined,
      dispose: () => undefined,
    };
  }

  // 显式收窄一次：下面的闭包里 TS 不再保留早期的空值判断。
  const gl: WebGL2RenderingContext = context;

  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const blurProgram = createProgram(gl, BLUR_FRAGMENT_SHADER);
  const finalProgram = createProgram(gl, FINAL_FRAGMENT_SHADER);
  if (!blurProgram || !finalProgram) {
    // shader 编译/链接失败：当作不支持，别让后面拿 null program 去调 GL。
    console.warn("[adjust-preview] 着色器程序创建失败，预览不可用");
    return {
      supported: false,
      imageWidth: 0,
      imageHeight: 0,
      maxTextureSize,
      setImage: () => undefined,
      render: () => undefined,
      dispose: () => undefined,
    };
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const imageTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, imageTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

  let imageWidth = 0;
  let imageHeight = 0;
  let hasImage = false;
  let bufferWidth = 0;
  let bufferHeight = 0;
  let blurTargets: [WebGLTexture, WebGLTexture] | null = null;
  let clarityTargets: [WebGLTexture, WebGLTexture] | null = null;
  let disposed = false;
  const framebuffer = gl.createFramebuffer();

  const blurUniforms = {
    image: gl.getUniformLocation(blurProgram!, "uImage"),
    imageSize: gl.getUniformLocation(blurProgram!, "uImageSize"),
    canvasSize: gl.getUniformLocation(blurProgram!, "uCanvasSize"),
    offset: gl.getUniformLocation(blurProgram!, "uOffset"),
    scale: gl.getUniformLocation(blurProgram!, "uScale"),
    step: gl.getUniformLocation(blurProgram!, "uStep"),
    weights: gl.getUniformLocation(blurProgram!, "uWeights"),
    sourceIsScreen: gl.getUniformLocation(blurProgram!, "uSourceIsScreen"),
  };
  const finalUniforms = {
    image: gl.getUniformLocation(finalProgram!, "uImage"),
    imageRaw: gl.getUniformLocation(finalProgram!, "uImageRaw"),
    clarityLow: gl.getUniformLocation(finalProgram!, "uClarityLow"),
    imageSize: gl.getUniformLocation(finalProgram!, "uImageSize"),
    canvasSize: gl.getUniformLocation(finalProgram!, "uCanvasSize"),
    offset: gl.getUniformLocation(finalProgram!, "uOffset"),
    scale: gl.getUniformLocation(finalProgram!, "uScale"),
    colorMatrix: gl.getUniformLocation(finalProgram!, "uColorMatrix"),
    linearA: gl.getUniformLocation(finalProgram!, "uLinearA"),
    linearB: gl.getUniformLocation(finalProgram!, "uLinearB"),
    noiseSigma: gl.getUniformLocation(finalProgram!, "uNoiseSigma"),
    speckleSigma: gl.getUniformLocation(finalProgram!, "uSpeckleSigma"),
    clarityAmount: gl.getUniformLocation(finalProgram!, "uClarityAmount"),
    useBlurred: gl.getUniformLocation(finalProgram!, "uUseBlurred"),
    splitX: gl.getUniformLocation(finalProgram!, "uSplitX"),
  };

  /** 模糊和清晰度各用一对 ping-pong 目标。 */
  function ensureTargets(width: number, height: number) {
    if (bufferWidth === width && bufferHeight === height && blurTargets && clarityTargets) return;
    for (const pair of [blurTargets, clarityTargets]) {
      if (pair) for (const texture of pair) gl.deleteTexture(texture);
    }
    const create = () => {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return texture;
    };
    blurTargets = [create(), create()];
    clarityTargets = [create(), create()];
    bufferWidth = width;
    bufferHeight = height;
  }

  function bindTarget(pair: [WebGLTexture, WebGLTexture] | null, index: 0 | 1) {
    if (!pair) return;
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pair[index], 0);
  }

  function drawBlurPass(
    source: WebGLTexture | null,
    stepX: number,
    stepY: number,
    offset: readonly [number, number],
    scale: number,
    width: number,
    height: number,
    sourceIsScreen: boolean,
  ) {
    gl.useProgram(blurProgram);
    gl.bindTexture(gl.TEXTURE_2D, source);
    gl.uniform1i(blurUniforms.image, 0);
    gl.uniform2f(blurUniforms.imageSize, imageWidth, imageHeight);
    gl.uniform2f(blurUniforms.canvasSize, width, height);
    gl.uniform2f(blurUniforms.offset, offset[0], offset[1]);
    gl.uniform1f(blurUniforms.scale, scale);
    gl.uniform2f(blurUniforms.step, stepX, stepY);
    gl.uniform1fv(blurUniforms.weights, BLUR_WEIGHTS);
    gl.uniform1f(blurUniforms.sourceIsScreen, sourceIsScreen ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  return {
    supported: Boolean(blurProgram && finalProgram),
    get imageWidth() { return imageWidth; },
    get imageHeight() { return imageHeight; },
    maxTextureSize,

    setImage(source, width, height) {
      imageWidth = Math.max(1, Math.round(width));
      imageHeight = Math.max(1, Math.round(height));
      gl.bindTexture(gl.TEXTURE_2D, imageTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.generateMipmap(gl.TEXTURE_2D);
      hasImage = true;
    },

    render(options) {
      if (!hasImage || !blurProgram || !finalProgram) return;
      const ratio = Number.isFinite(options.devicePixelRatio) && options.devicePixelRatio > 0
        ? options.devicePixelRatio
        : 1;
      const width = Math.max(1, Math.round(options.cssWidth * ratio));
      const height = Math.max(1, Math.round(options.cssHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const adjustments = options.bypass
        ? normalizeImageAdjustments({})
        : normalizeImageAdjustments(options.adjustments);
      const scale = options.view.scale;
      const offset: [number, number] = [options.view.offsetX, options.view.offsetY];
      if (!Number.isFinite(scale) || scale <= 0) {
        // 视口没算好时不要重绘：那会把整屏画成透明，把上一帧的好画面盖掉。
        return;
      }

      gl.viewport(0, 0, width, height);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      ensureTargets(width, height);
      let colorSource: WebGLTexture | null = imageTexture;
      const sigmaScreen = adjustments.blur * scale;
      if (sigmaScreen > 0.75) {
        // 采样间隔按"图像空间 ±3σ 分 12 份"换算到屏幕像素
        const stepPx = (adjustments.blur * 3) / BLUR_TAPS * scale;
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        bindTarget(blurTargets, 0);
        drawBlurPass(imageTexture, stepPx, 0, offset, scale, width, height, false);
        bindTarget(blurTargets, 1);
        drawBlurPass(blurTargets![0], 0, stepPx, offset, scale, width, height, true);
        colorSource = blurTargets![1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }

      // 清晰度：对当前这层做一次大半径低通，最终合成时只把亮度上的差值加回去。
      const clarityAmount = options.clarityAmount ?? 0;
      let clarityLow: WebGLTexture | null = null;
      const claritySigmaPx = (options.claritySigma ?? 0) * scale;
      if (clarityAmount > 0 && claritySigmaPx > 0.75) {
        const stepPx = (claritySigmaPx * 3) / BLUR_TAPS;
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        bindTarget(clarityTargets, 0);
        drawBlurPass(colorSource, stepPx, 0, offset, scale, width, height, colorSource !== imageTexture);
        bindTarget(clarityTargets, 1);
        drawBlurPass(clarityTargets![0], 0, stepPx, offset, scale, width, height, true);
        clarityLow = clarityTargets![1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }

      gl.useProgram(finalProgram);
      // 原图始终挂在 1 号纹理单元上：分割对比的右侧要用它。
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, imageTexture);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, clarityLow ?? imageTexture);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, colorSource);
      gl.uniform1i(finalUniforms.image, 0);
      gl.uniform1i(finalUniforms.imageRaw, 1);
      gl.uniform1i(finalUniforms.clarityLow, 2);
      gl.uniform1f(finalUniforms.clarityAmount, clarityLow ? clarityAmount : 0);
      gl.uniform2f(finalUniforms.imageSize, imageWidth, imageHeight);
      gl.uniform2f(finalUniforms.canvasSize, width, height);
      gl.uniform2f(finalUniforms.offset, offset[0], offset[1]);
      gl.uniform1f(finalUniforms.scale, scale);
      gl.uniformMatrix3fv(finalUniforms.colorMatrix, false, colorMatrixFor(adjustments));
      const contrast = adjustments.contrast;
      const brightness = adjustments.brightness;
      gl.uniform1f(finalUniforms.linearA, contrast * brightness);
      gl.uniform1f(finalUniforms.linearB, (1 - contrast) * 0.5);
      gl.uniform1f(finalUniforms.noiseSigma, (adjustments.noise / 100) * (IMAGE_ADJUSTMENT_NOISE_MAX_SIGMA / 255));
      gl.uniform1f(finalUniforms.speckleSigma, (adjustments.speckle / 100) * (IMAGE_ADJUSTMENT_SPECKLE_MAX_SIGMA / 255));
      gl.uniform1f(finalUniforms.useBlurred, colorSource === imageTexture ? 0 : 1);
      gl.uniform1f(finalUniforms.splitX, !options.bypass && options.splitX != null && options.splitX >= 0 ? options.splitX : -1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.activeTexture(gl.TEXTURE0);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const pair of [blurTargets, clarityTargets]) {
        if (pair) for (const texture of pair) gl.deleteTexture(texture);
      }
      gl.deleteTexture(imageTexture);
      gl.deleteBuffer(quad);
      gl.deleteFramebuffer(framebuffer);
      if (blurProgram) gl.deleteProgram(blurProgram);
      if (finalProgram) gl.deleteProgram(finalProgram);
    },
  };
}
