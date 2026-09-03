import type { NativeSmartReverseResult } from "../nativeCanvas";

export function smartReverseResultText(result: NativeSmartReverseResult, language = "zh-CN") {
  const outputs = Array.isArray(result?.outputs) ? result.outputs : [];
  if (outputs.length <= 1) return String(outputs[0]?.detailedPrompt || "").trim();
  return outputs
    .map((output, index) => `${language.toLowerCase().startsWith("zh") ? `图${index + 1}` : `Image ${index + 1}`}\n${String(output?.detailedPrompt || "").trim()}`.trim())
    .filter(Boolean)
    .join("\n\n");
}
