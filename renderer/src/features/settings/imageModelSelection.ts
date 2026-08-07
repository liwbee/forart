function matchingOption(options: readonly string[], value: string | undefined) {
  const candidate = String(value || "").trim();
  if (!candidate) return undefined;
  return options.find((option) => option === candidate)
    || options.find((option) => option.toLocaleLowerCase() === candidate.toLocaleLowerCase());
}

function fallbackOption(options: readonly string[], fallback: string) {
  return matchingOption(options, fallback) || options[0] || fallback;
}

export function reconcileStringOption(
  options: readonly string[],
  value: string | undefined,
  fallback: string,
) {
  return matchingOption(options, value) || fallbackOption(options, fallback);
}

function resolutionTier(value: string | undefined) {
  const match = String(value || "").trim().match(/^(\d+(?:\.\d+)?)k$/i);
  return match ? Number(match[1]) : null;
}

export function reconcileResolution(
  options: readonly string[],
  value: string | undefined,
  fallback: string,
) {
  const exact = matchingOption(options, value);
  if (exact) return exact;

  const requestedTier = resolutionTier(value);
  if (requestedTier !== null) {
    const fallbackValue = fallbackOption(options, fallback);
    const nearest = options
      .map((option) => ({ option, tier: resolutionTier(option) }))
      .filter((item): item is { option: string; tier: number } => item.tier !== null)
      .sort((left, right) => {
        const distance = Math.abs(left.tier - requestedTier) - Math.abs(right.tier - requestedTier);
        if (distance !== 0) return distance;
        if (left.option === fallbackValue) return -1;
        if (right.option === fallbackValue) return 1;
        return left.tier - right.tier;
      })[0];
    if (nearest) return nearest.option;
  }

  return fallbackOption(options, fallback);
}

function aspectRatioValue(value: string | undefined) {
  const match = String(value || "").trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

export function reconcileAspectRatio(
  options: readonly string[],
  value: string | undefined,
  fallback: string,
) {
  const exact = matchingOption(options, value);
  if (exact) return exact;

  const requestedRatio = aspectRatioValue(value);
  if (requestedRatio !== null) {
    const fallbackValue = fallbackOption(options, fallback);
    const nearest = options
      .map((option) => ({ option, ratio: aspectRatioValue(option) }))
      .filter((item): item is { option: string; ratio: number } => item.ratio !== null)
      .sort((left, right) => {
        const distance = Math.abs(Math.log(left.ratio / requestedRatio))
          - Math.abs(Math.log(right.ratio / requestedRatio));
        if (Math.abs(distance) > Number.EPSILON) return distance;
        if (left.option === fallbackValue) return -1;
        if (right.option === fallbackValue) return 1;
        return 0;
      })[0];
    if (nearest) return nearest.option;
  }

  return fallbackOption(options, fallback);
}

export function reconcileImageCount(
  options: readonly number[],
  value: number | undefined,
  fallback: number,
) {
  const requested = Number(value);
  if (options.includes(requested)) return requested;
  if (Number.isFinite(requested) && options.length) {
    return [...options].sort((left, right) => {
      const distance = Math.abs(left - requested) - Math.abs(right - requested);
      if (distance !== 0) return distance;
      if (left === fallback) return -1;
      if (right === fallback) return 1;
      return left - right;
    })[0];
  }
  return options.includes(fallback) ? fallback : options[0] || fallback;
}
