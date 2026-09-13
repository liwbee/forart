import { useRef } from "react";
import { Images, Upload } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";
import type { NativeCanvasNodeData, BatchImageGeneratorItem } from "../nativeCanvas";
import { useNativeCanvasActions } from "../canvasActions";

export function BatchImageGeneratorNodeBody({ nodeId, data }: { nodeId: string; data: NativeCanvasNodeData }) {
  const actions = useNativeCanvasActions();
  const inputRef = useRef<HTMLInputElement>(null);
  const state = data.batchImageGenerator || { items: [], prompt: "", layout: "list" };
  const items = state.items || [];
  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const next = [...items];
    for (const file of Array.from(files).slice(0, Math.max(0, 50 - next.length))) {
      if (!file.type.startsWith("image/")) continue;
      const sourceUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.readAsDataURL(file);
      });
      next.push({ id: crypto.randomUUID(), sourceUrl, sourceFileName: file.name, status: "pending" });
    }
    actions.patchNodeData(nodeId, { batchImageGenerator: { ...state, items: next } });
  };
  const patchState = (patch: Partial<typeof state>) => actions.patchNodeData(nodeId, { batchImageGenerator: { ...state, ...patch } });
  return <div className="rf-batch-image-generator">
    <div className="rf-batch-image-generator__prompt"><Textarea value={state.prompt || ""} placeholder="输入批量处理提示词" onChange={(e) => patchState({ prompt: e.target.value })} /></div>
    <div className="rf-batch-image-generator__toolbar"><Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()}><Upload data-icon="inline-start" />上传图片（最多 50 张）</Button><span>{items.length} 张图片</span><input ref={inputRef} hidden type="file" accept="image/*" multiple onChange={(e) => { void addFiles(e.target.files); e.currentTarget.value = ""; }} /></div>
    <div className="rf-batch-image-generator__list">{items.map((item: BatchImageGeneratorItem, index) => <div className="rf-batch-image-generator__row" key={item.id}><img src={item.sourceUrl} alt={item.sourceFileName || `图片 ${index + 1}`} /><div><strong>{item.sourceFileName || `图片 ${index + 1}`}</strong>{items.length > 0 && <small>主图{index === 0 ? " · 混合图片" : ""}</small>}</div><div className="rf-batch-image-generator__result">{item.resultUrl ? <img src={item.resultThumbUrl || item.resultUrl} alt="生成结果" /> : <Images />}</div></div>)}</div>
  </div>;
}
