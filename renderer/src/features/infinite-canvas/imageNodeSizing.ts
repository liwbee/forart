export const ASSET_LOADER_DEFAULT_SIZE = { width: 240, height: 320 } as const;
export const VIDEO_NODE_DEFAULT_SIZE = { width: 420, height: 280 } as const;
export const IMAGE_GENERATOR_DEFAULT_SIZE = { width: 280, height: 280 } as const;

export function getImageNodeSize(naturalWidth: number, naturalHeight: number) {
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) return ASSET_LOADER_DEFAULT_SIZE;
  const targetArea = 240 * 320;
  let scale = Math.sqrt(targetArea / (naturalWidth * naturalHeight));
  if (naturalWidth * scale > 420) scale = 420 / naturalWidth;
  if (naturalHeight * scale > 420) scale = 420 / naturalHeight;
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  };
}

/**
 * Video surfaces need a larger working area than image assets because the
 * transport controls and timeline are only usable above a reasonable width.
 * Keep the source aspect ratio while allowing a larger maximum than images.
 */
export function getVideoNodeSize(naturalWidth: number, naturalHeight: number) {
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) return VIDEO_NODE_DEFAULT_SIZE;
  const targetArea = VIDEO_NODE_DEFAULT_SIZE.width * VIDEO_NODE_DEFAULT_SIZE.height;
  const ratio = naturalWidth / naturalHeight;
  let width = Math.sqrt(targetArea * ratio);
  let height = width / ratio;
  const maxDimension = Math.max(width, height);
  if (maxDimension > 640) {
    const scale = 640 / maxDimension;
    width *= scale;
    height *= scale;
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

export function getImageGeneratorNodeSize(aspectRatio: string | undefined) {
  const match = aspectRatio?.match(/^(\d+(?:\.\d+)?)\s*[:xX×]\s*(\d+(?:\.\d+)?)$/);
  if (!match) return IMAGE_GENERATOR_DEFAULT_SIZE;
  const ratioWidth = Number(match[1]);
  const ratioHeight = Number(match[2]);
  if (!(ratioWidth > 0) || !(ratioHeight > 0)) return IMAGE_GENERATOR_DEFAULT_SIZE;

  const targetArea = 280 * 280;
  const ratio = ratioWidth / ratioHeight;
  let width = Math.sqrt(targetArea * ratio);
  let height = width / ratio;
  const maxDimension = Math.max(width, height);
  if (maxDimension > 420) {
    const scale = 420 / maxDimension;
    width *= scale;
    height *= scale;
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}
