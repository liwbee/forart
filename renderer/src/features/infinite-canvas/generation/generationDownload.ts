import type { TFunction } from "i18next";
import { toast } from "sonner";
import type { GenerationTaskDto } from "../../../app/appConfig";
import { resolveLibraryImageUrl } from "../../../lib/libraryImageActions";
import { FALLBACK_DOWNLOAD_NAME } from "../assetNaming";
import { loadGenerationTasks } from "./generationTaskCache";

// 文件名在结果落库时由主进程 generation-naming.cjs 一次定死
// （生成结果：平台-模型-生成时刻时间戳，多图追加序号；派生资产：Crop-/Matting- 等前缀）；
// 下载侧直接使用资产在库中的名字，同名冲突由保存层自动加序号去重。
// 新增节点只要把结果的 fileName 存进节点数据，就自动获得正确命名，不需要自己拼名字。
//
// 结果保存层：easyTool.saveResult 优先，浏览器 <a download> 兜底。
// 所有下载入口（画布节点、派生节点、动作裂变行、任务中心）共用。
export async function saveGenerationImageFile(options: {
  imageUrl: string;
  defaultName?: string;
  convertToPng?: boolean;
  directory?: string;
  t: TFunction;
}) {
  const { imageUrl, convertToPng = true, directory, t } = options;
  const defaultName = String(options.defaultName || "").trim() || FALLBACK_DOWNLOAD_NAME;
  const resolvedUrl = resolveLibraryImageUrl(imageUrl);
  try {
    if (window.easyTool?.saveResult) {
      const result = await window.easyTool.saveResult({
        url: resolvedUrl,
        dataUrl: resolvedUrl,
        defaultName,
        convertToPng,
        ...(directory !== undefined ? { directory } : {}),
      });
      toast.success(result.filePath
        ? t("infiniteCanvas:downloadSaved", { path: result.filePath })
        : t("infiniteCanvas:downloadComplete"));
      return true;
    }
    const link = document.createElement("a");
    link.href = resolvedUrl;
    link.download = defaultName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast.success(t("infiniteCanvas:downloadComplete"));
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
    return false;
  }
}

export interface GenerationResultDownloadPlan {
  // 仅供 resolveTarget 需要任务结果兜底时加载（动作裂变行）；纯节点数据下载可省。
  taskId?: string;
  resolveTarget: (task: GenerationTaskDto | undefined) => { imageUrl: string; fileName?: string } | null;
  convertToPng?: boolean;
  directory?: string;
}

export interface GenerationResultDownloadOutcome {
  task: GenerationTaskDto | undefined;
  // false 表示目标缺失或保存失败，调用方不应回写下载状态。
  saved: boolean;
}

// 生成结果下载管线：解析目标 → 按落库文件名保存。
export async function downloadGenerationResult(plan: GenerationResultDownloadPlan, t: TFunction): Promise<GenerationResultDownloadOutcome> {
  const [task] = plan.taskId ? await loadGenerationTasks([plan.taskId]) : [];
  const target = plan.resolveTarget(task);
  if (!target || !target.imageUrl) return { task, saved: false };
  const saved = await saveGenerationImageFile({
    imageUrl: target.imageUrl,
    defaultName: target.fileName,
    convertToPng: plan.convertToPng,
    directory: plan.directory,
    t,
  });
  return { task, saved };
}
