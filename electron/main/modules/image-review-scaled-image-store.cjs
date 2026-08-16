const fs = require('node:fs');
const sharp = require('sharp');
const fsp = fs.promises;

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_CONCURRENT = 3;

function createCacheClearedError() {
  const error = new Error('Image review scaled image cache was cleared');
  error.code = 'IMAGE_REVIEW_CACHE_CLEARED';
  return error;
}

function isImageReviewCacheClearedError(error) {
  return error?.code === 'IMAGE_REVIEW_CACHE_CLEARED';
}

function createImageReviewScaledImageStore({
  maxBytes = DEFAULT_MAX_BYTES,
  maxConcurrent = DEFAULT_MAX_CONCURRENT,
  sharpFactory = sharp,
} = {}) {
  const cache = new Map();
  const inFlight = new Map();
  const queue = [];
  let active = 0;
  let totalBytes = 0;
  let cacheGeneration = 0;

  function touch(key, entry) {
    cache.delete(key);
    cache.set(key, entry);
  }

  function evict() {
    while (totalBytes > maxBytes && cache.size) {
      const oldestKey = cache.keys().next().value;
      const oldest = cache.get(oldestKey);
      cache.delete(oldestKey);
      totalBytes -= oldest?.buffer?.byteLength || 0;
    }
  }

  function runNext() {
    while (active < maxConcurrent && queue.length) {
      let nextIndex = 0;
      for (let index = 1; index < queue.length; index += 1) {
        if (queue[index].priority > queue[nextIndex].priority) nextIndex = index;
      }
      const [next] = queue.splice(nextIndex, 1);
      if (next.generation !== cacheGeneration) {
        next.reject(createCacheClearedError());
        continue;
      }
      active += 1;
      Promise.resolve()
        .then(next.task)
        .then(next.resolve, next.reject)
        .finally(() => {
          active -= 1;
          runNext();
        });
    }
  }

  function enqueue(task, generation, priority, cacheKey) {
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject, generation, priority, cacheKey });
      runNext();
    });
  }

  async function generate(filePath, size, priority = 0) {
    const stats = await fsp.stat(filePath);
    const cacheKey = `${filePath}|${stats.size}|${stats.mtimeMs}|${size}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      touch(cacheKey, cached);
      return cached;
    }

    const existing = inFlight.get(cacheKey);
    if (existing?.generation === cacheGeneration) {
      const pending = queue.find((item) => item.cacheKey === cacheKey);
      if (pending) pending.priority = Math.max(pending.priority, priority);
      return existing.promise;
    }

    const generationAtRequest = cacheGeneration;
    const task = enqueue(async () => {
      if (generationAtRequest !== cacheGeneration) throw createCacheClearedError();
      const latestStats = await fsp.stat(filePath);
      const latestKey = `${filePath}|${latestStats.size}|${latestStats.mtimeMs}|${size}`;
      const latestCached = cache.get(latestKey);
      if (latestCached) {
        touch(latestKey, latestCached);
        return latestCached;
      }

      const pipeline = sharpFactory(filePath, { animated: false }).rotate();
      const metadata = typeof pipeline.metadata === 'function' ? await pipeline.metadata() : {};
      if (generationAtRequest !== cacheGeneration) throw createCacheClearedError();
      pipeline.resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true });
      pipeline.webp(metadata.hasAlpha
        ? { lossless: true, effort: 4 }
        : { quality: 82, smartSubsample: true });
      const buffer = await pipeline.toBuffer();
      const entry = { buffer, contentType: 'image/webp' };
      if (generationAtRequest === cacheGeneration) {
        cache.set(latestKey, entry);
        totalBytes += buffer.byteLength;
        evict();
      }
      return entry;
    }, generationAtRequest, priority, cacheKey).finally(() => {
      if (inFlight.get(cacheKey)?.promise === task) inFlight.delete(cacheKey);
    });

    inFlight.set(cacheKey, { generation: generationAtRequest, promise: task });
    return task;
  }

  function clear() {
    cacheGeneration += 1;
    cache.clear();
    totalBytes = 0;
    for (const pending of queue.splice(0)) pending.reject(createCacheClearedError());
  }

  function stats() {
    return { entries: cache.size, bytes: totalBytes, queued: queue.length, active };
  }

  return { generate, clear, stats };
}

module.exports = {
  createImageReviewScaledImageStore,
  isImageReviewCacheClearedError,
};
