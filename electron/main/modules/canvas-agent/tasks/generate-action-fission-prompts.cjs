const { z } = require('zod');

const actionFissionPromptGenerationSchema = z.object({
  prompts: z.array(z.object({
    rowId: z.string(),
    prompt: z.string(),
    label: z.string(),
    warnings: z.array(z.string()),
  })),
});

const FIGURE_LABELS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

// 提示词要求固定分段，模型偶尔会把段落挤在一行或用别的分隔符，
// 这里统一按标签断行，保证卡片里看到的结构是可读的。
const PROMPT_SECTION_LABELS = [
  '参考图',
  '构图',
  '动作',
  '风格',
  '氛围',
  '光影',
  '环境',
  '材质',
  '镜头',
  '背景',
  '服装',
  '配饰',
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SECTION_SPLIT_PATTERN = new RegExp(
  `\\s*(?=(?:${PROMPT_SECTION_LABELS.map(escapeRegExp).join('|')})\\s*[:：])`,
  'g',
);

function formatActionFissionPrompt(prompt) {
  const source = String(prompt || '').replace(/\r\n?/g, '\n').trim();
  if (!source) return '';
  return source
    .split('\n')
    .flatMap((line) => line.split(SECTION_SPLIT_PATTERN))
    .map((line) => line.replace(/^[\s，,。；;]+/, '').trim())
    .filter(Boolean)
    .join('\n');
}

function figureLabel(index) {
  return `@图${FIGURE_LABELS[index] || index + 1}`;
}

// 与主进程 resolveImageParts 的取源规则保持一致：只有能取到图片地址的参考
// 才会真的作为图片发送，因此这里的编号也必须跳过空地址，否则 @图N 会错位。
function hasImageSource(item) {
  return Boolean(String(item?.imageUrl || item?.assetUrl || item?.localUrl || item?.url || '').trim());
}

function actionFissionPromptGenerationMessages(context, language) {
  const english = language === 'en-US';
  const references = (Array.isArray(context?.referenceImages) ? context.referenceImages : [])
    .filter(hasImageSource);
  const rows = Array.isArray(context?.rows) ? context.rows : [];
  const indexById = new Map(references.map((item, index) => [String(item?.id || ''), index]));
  const referenceLines = references.map((item, index) => {
    const role = item?.role === 'additional'
      ? (english ? 'additional reference' : '附加参考')
      : (english ? 'primary reference' : '主参考');
    const title = String(item?.title || '').trim();
    const suffix = title ? (english ? `: ${title}` : `：${title}`) : '';
    return english
      ? `[Image ${index + 1}: ${figureLabel(index)} (${role}${suffix})]`
      : `[参考图 ${index + 1}：${figureLabel(index)}（${role}${suffix}）]`;
  });
  const rowLines = rows.map((row, index) => {
    const ids = Array.isArray(row?.additionalReferenceIds) ? row.additionalReferenceIds : [];
    const labels = ids.flatMap((id) => {
      const referenceIndex = indexById.get(String(id));
      return Number.isInteger(referenceIndex) ? [figureLabel(referenceIndex)] : [];
    });
    const used = labels.length ? labels.join(english ? ', ' : '、') : (english ? 'none' : '无');
    return english
      ? `- Row ${index + 1} (rowId: ${String(row?.rowId || '')}): additional references ${used}`
      : `- 行 ${index + 1}（rowId: ${String(row?.rowId || '')}）：附加参考 ${used}`;
  });
  const instruction = String(context?.instruction || '').trim();
  const instructionBlock = instruction || (english ? '(none)' : '（无）');

  const system = english
    ? `You generate prompts for Forart's action fission node. You receive a set of reference images and several card rows, and must return one finished image-generation prompt per row.

Rules:
1. Return exactly one prompt per row, and make the rows clearly different in action, pose, camera, expression, composition, scene, or interaction with clothing and accessories. You decide the differentiation axes.
2. Never change the identity or number of the people in the reference images, and never change the key traits of their clothing and accessories. Never invent brands or props that are not visible in the references.
3. When several reference images are given and the user does not explain their relationship, treat the first image as the main subject reference and the others as style, clothing, scene, prop, or detail supplements based on what is visible.
4. Each row may only use the additional references marked for that row. Do not use another row's additional references in it.
5. When the user provides a group instruction, follow it first.
6. Prompts must contain visual content only. Never include resolution, size, aspect ratio, quality tier, image count, or similar technical parameters, and never write labels such as "image 1" or "card A".
7. Every prompt contains exactly two sections, one per line, no blank lines, always in this order:
   "构图:" the shot type and framing, e.g. a full-body shot from head to toe.
   "动作:" pose, hands, legs, gaze, body direction — this is where you may add the most detail.
   Never write reference usage, clothing, accessories, scene, style, lighting, or mood: the user adds those through prompt nodes.
8. Use label for a short summary of the row in the form "<action>·<framing or angle>", for example "单手插兜·全身侧面". Keep it under 12 characters and never use a period.
9. Put only genuine warnings in warnings; return an empty array when there are none.
10. Echo each rowId exactly as provided.
Output in English.`
    : `你是 Forart 动作裂变的提示词生成模块。你会收到一组参考图和若干卡片行，需要为每一行生成一条可以直接送去生图的完整提示词。

规则：
1. 必须为每一行返回一条提示词，并且行与行之间在动作、姿态、镜头、表情、构图、场景或与服装配饰的互动上有明确差异；差异维度由你自行规划。
2. 不得改变参考图中的人物身份、人物数量和服装配饰的关键特征，不得虚构参考图中不存在的品牌或道具。
3. 多张参考图且用户没有说明关系时，默认第一张是主体参考，其余图片按可见内容理解为风格、服装、场景、道具或细节补充。
4. 每一行只使用它自己标注的附加参考图，不要在该行里引用其他行的附加参考图。
5. 用户给出整组创作要求时，优先遵循用户要求。
6. 提示词只写画面内容。不要写分辨率、尺寸、宽高比、画质档位、生成数量等技术参数，也不要写「第 1 张」「卡位 A」这类编号说明。
7. 每条提示词只包含两段，一段一行，不要空行，顺序固定：
   构图：写镜头类型与取景，例如「从头到脚的全身镜头」。
   动作：写姿态、手部、腿部、视线、身体朝向等；这一段可以写得最详细，你可以自由发挥。
   不要写参考图用法、服装、配饰、场景、风格、光影或氛围，这些由用户自己通过提示词节点补充。
8. label 用「动作·构图或角度」的形式概括这一行，例如「单手插兜·全身侧面」，不超过 12 个字，不要用句号。
9. warnings 只写确实需要提醒用户的问题，没有就返回空数组。
10. rowId 必须原样返回输入中的值。
输出中文。`;

  const user = english
    ? `Group instruction:
${instructionBlock}

Reference images (${figureLabel(0)} is the first image):
${referenceLines.length ? referenceLines.join('\n') : '(none)'}

Card rows to generate:
${rowLines.length ? rowLines.join('\n') : '(none)'}`
    : `整组创作要求：
${instructionBlock}

参考图（${figureLabel(0)} 对应第 1 张）：
${referenceLines.length ? referenceLines.join('\n') : '（无）'}

需要生成的卡片行：
${rowLines.length ? rowLines.join('\n') : '（无）'}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

module.exports = {
  actionFissionPromptGenerationMessages,
  actionFissionPromptGenerationSchema,
  figureLabel,
  formatActionFissionPrompt,
};
