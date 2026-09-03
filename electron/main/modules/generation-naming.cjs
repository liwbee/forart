const FILE_EXTENSION_PATTERN = /(\.[a-z0-9]{2,5})$/i;

function sanitizePart(value, fallback) {
  const sanitized = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return sanitized || fallback;
}

function formatGenerationTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function fileExtension(value) {
  const cleanValue = String(value || '').split(/[?#]/, 1)[0];
  const match = cleanValue.match(FILE_EXTENSION_PATTERN);
  return match?.[1].toLowerCase() || '.png';
}

// 生成结果落库命名：平台-模型-生成时刻时间戳，多图从第二张起追加序号。
// 任务字段（executorKind/providerName/providerId/model）来自任务仓库。
function generationResultFileName(task = {}, index = 0, sourceFileName, date = new Date()) {
  const platform = task.executorKind === 'libtv'
    ? 'LibTV'
    : sanitizePart(task.providerName || task.providerId, 'Forart');
  const base = `${platform}-${sanitizePart(task.model, 'Local')}-${formatGenerationTimestamp(date)}`;
  const suffix = index > 0 ? `-${index + 1}` : '';
  return `${base}${suffix}${fileExtension(sourceFileName)}`;
}

module.exports = { generationResultFileName };
