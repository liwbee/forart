const { z } = require('zod');

const imagePromptOptimizationSchema = z.object({
  optimizedPrompt: z.string(),
  preserved: z.array(z.string()),
  changes: z.array(z.object({ category: z.string(), summary: z.string() })),
  warnings: z.array(z.string()),
});

// Keep generation controls in the node settings rather than duplicating them
// in the semantic prompt. This is intentionally conservative so ordinary
// visual numbers (ages, clothing details, dates, etc.) remain untouched.
function removeTechnicalPromptParameters(prompt) {
  return String(prompt || '')
    .replace(/\b\d{2,5}\s*[x×]\s*\d{2,5}\b/gi, '')
    .replace(/(?:宽高比|画面比例|比例)\s*[:：]?\s*\d+(?:\.\d+)?\s*[:：]\s*\d+(?:\.\d+)?/gi, '')
    .replace(/(?<![\w])\d+(?:\.\d+)?\s*[:：]\s*\d+(?:\.\d+)?(?![\w])/g, '')
    .replace(/\b\d+(?:\.\d+)?\s*k\b/gi, '')
    .replace(/(?:分辨率|像素尺寸|尺寸)\s*[:：]?\s*\d{2,5}\s*(?:x|×)\s*\d{2,5}/gi, '')
    .replace(/(?:生成数量|生成\s*\d+\s*张|生成一张|生成两张|生成三张)/gi, '')
    .replace(/(?:超高清|高画质|高清画质|画质档位)\s*[,，]?/gi, '')
    .replace(/([，,、])\s*(?=[，,、])/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([，。；：、])/g, '$1')
    .trim();
}

function formatOptimizedPromptLines(prompt, maxLineLength = 56) {
  const source = String(prompt || '').replace(/\r\n?/g, '\n').trim();
  if (!source) return '';
  const sourceLines = source.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (sourceLines.length > 1) return sourceLines.join('\n');

  const clauses = source.match(/[^，,。；;！？!?]+[，,。；;！？!?]?/g)
    ?.map((clause) => clause.trim())
    .filter(Boolean) || [source];
  if (clauses.length < 3 || source.length <= maxLineLength) return source;

  const lines = [];
  let current = '';
  for (const clause of clauses) {
    if (current && current.length + clause.length > maxLineLength) {
      lines.push(current);
      current = clause;
    } else {
      current += clause;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}

function imagePromptOptimizationMessages(context, language) {
  const connectedPrompts = Array.isArray(context?.promptInputs)
    ? context.promptInputs.map((item, index) => `\n[连接 Prompt ${index + 1}] ${String(item?.text || '').trim()}`).join('')
    : '';
  const referenceSummary = Array.isArray(context?.referenceImages)
    ? context.referenceImages.map((item, index) => `\n[参考图 ${index + 1}：@图${['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][index] || index + 1}] ${String(item?.title || '').trim()}`).join('')
    : '';
  return [
    {
      role: 'system',
      content: `你是 Forart 的 Image Generator 提示词优化模块。保留用户意图和已有关键约束，只补足可执行的视觉细节。${language === 'en-US' ? 'Output in English.' : '输出中文。'}优化后的 optimizedPrompt 只写视觉内容、主体、动作、构图、光影、材质、环境和风格；不要写分辨率、尺寸、宽高比、画质档位、生成数量等技术参数。optimizedPrompt 应按语义自然分行，将主体与外观、动作与参考图互动、构图与镜头、光影与环境、材质与风格分别组织成简短行；不要添加“主体：”等标题或项目符号。严格返回结构化结果，不要生成解释性散文。引用参考图时，必须使用精确的 @图一、@图二 等标记，不要只写“参考图1”。`,
    },
    {
      role: 'user',
      content: `当前 Prompt：\n${String(context?.prompt || '').trim()}\n\n连接的 Prompt：${connectedPrompts || '\n（无）'}\n\n生成参数（仅用于理解上下文，禁止写入 optimizedPrompt）：模型 ${String(context?.model || '')}，比例 ${String(context?.aspectRatio || '')}，尺寸 ${String(context?.resolution || '')}，自定义像素 ${String(context?.customSize || '')}，画质 ${String(context?.quality || '')}，生成数量 ${String(context?.imageCount || 1)}${referenceSummary}\n\n参考图标记规则：如果描述涉及某一张特定参考图，必须在 optimizedPrompt 中使用对应的 @图一、@图二 等标记；只有确实需要区分参考图时才添加标记。`,
    },
  ];
}

module.exports = {
  formatOptimizedPromptLines,
  imagePromptOptimizationMessages,
  imagePromptOptimizationSchema,
  removeTechnicalPromptParameters,
};
