import { useTranslation } from "react-i18next";
import { Switch } from "../../../components/ui/switch";

export function AdditionalReferenceToggle({
  checked,
  disabled,
  onCheckedChange,
}: {
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  const stopPropagation = (event: React.SyntheticEvent) => event.stopPropagation();
  return (
    <div
      className="rf-action-fission-additional-toggle nodrag nopan"
      onPointerDown={stopPropagation}
      onClick={stopPropagation}
      onDoubleClick={stopPropagation}
    >
      <span>{t("infiniteCanvas:additionalReference")}</span>
      <Switch
        size="sm"
        checked={checked}
        disabled={disabled}
        aria-label={t("infiniteCanvas:useAdditionalReference")}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
