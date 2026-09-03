const { z } = require('zod');

const reversePromptSchema = z.object({
  mode: z.enum(['combined', 'separate']),
  relationshipSummary: z.string(),
  assetUses: z.array(z.object({ nodeId: z.string(), use: z.string() })),
  outputs: z.array(z.object({
    id: z.string(),
    sourceNodeIds: z.array(z.string()),
    summary: z.string(),
    detailedPrompt: z.string(),
    compactPrompt: z.string(),
    negativePrompt: z.string(),
    preserved: z.array(z.string()),
    avoid: z.array(z.string()),
    uncertainties: z.array(z.string()),
  })),
  warnings: z.array(z.string()),
});

function smartReverseMessages(context, language) {
  const instruction = String(context?.instruction || '').trim() || '请根据输入素材反推可编辑的生成提示词。';
  const chineseOrdinals = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const assetSummary = (Array.isArray(context?.assets) ? context.assets : [])
    .map((asset, index) => `素材 ${index + 1}（@图${chineseOrdinals[index] || index + 1}），节点 ${asset?.nodeId || `asset-${index + 1}`}`)
    .join('；');
  return [
    {
      role: 'system',
      content: `你是 Forart 的智能反推模块。根据输入素材推断可编辑的生成提示词，不声称还原原始 Prompt。${language === 'en-US' ? 'Output in English.' : '输出中文。'}\n用户要求中的 @图一、@图二（以及 @图1、@图2）等表示对应输入参考图。多图规则：用户未说明素材关系时逐个输出；用户要求组合时判断每个素材用途；明显无关时不要强行合并。严格返回结构化结果。`,
    },
    {
      role: 'user',
      content: `${instruction}\n输入素材：${assetSummary}\n请输出详细 Prompt、精简 Prompt、负面 Prompt、保留项、避免项和不确定项。`,
    },
  ];
}

module.exports = { smartReverseMessages: smartReverseMessages, smartReverseSchema: reversePromptSchema };
