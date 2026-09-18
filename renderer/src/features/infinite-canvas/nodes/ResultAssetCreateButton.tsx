import { ImagePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui/button";

/**
 * 批量类节点结果卡片左上角的角标。
 *
 * 平时只显示序号；鼠标悬浮或键盘聚焦卡片时，序号淡出、换成「创建素材节点」
 * 按钮。序号与按钮叠在同一个网格单元里，切换时不会引起布局跳动。
 */
export function ResultAssetCreateButton({
  index,
  disabled,
  onCreate,
}: {
  index: number;
  disabled?: boolean;
  onCreate: (clientPoint: { x: number; y: number }) => void;
}) {
  const { t } = useTranslation();
  const label = t("infiniteCanvas:createAssetNodeFromResult");
  const order = String(index).padStart(2, "0");
  const stopPropagation = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <div
      className="rf-action-fission-card-badge nodrag nopan"
      onPointerDown={stopPropagation}
      onClick={stopPropagation}
      onDoubleClick={stopPropagation}
    >
      <span className="rf-action-fission-card-index" aria-hidden="true">{order}</span>
      <Button
        className="rf-action-fission-card-create"
        type="button"
        variant="default"
        size="icon-xs"
        disabled={disabled}
        aria-label={label}
        title={label}
        onClick={(event) => {
          event.stopPropagation();
          onCreate({ x: event.clientX, y: event.clientY });
        }}
      >
        <ImagePlus aria-hidden="true" />
      </Button>
    </div>
  );
}
