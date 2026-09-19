import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Field, FieldLabel } from "../../../components/ui/field";
import { Textarea } from "../../../components/ui/textarea";
import type { ActionFissionRow } from "../action-fission/actionFissionTypes";

interface ActionFissionAgentPromptDialogProps {
  open: boolean;
  row: ActionFissionRow | null;
  onOpenChange: (open: boolean) => void;
  onSave: (prompt: string) => void;
}

/**
 * Agent 模式下的提示词编辑弹层。
 * 摘要只是卡片上的展示信息，不参与生图，所以这里只编辑真正会提交的提示词。
 */
export function ActionFissionAgentPromptDialog({
  open,
  row,
  onOpenChange,
  onSave,
}: ActionFissionAgentPromptDialogProps) {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (!open) return;
    setPrompt(String(row?.agentPrompt || ""));
  }, [open, row]);

  const submit = () => {
    const nextPrompt = prompt.trim();
    if (!nextPrompt) return;
    onSave(nextPrompt);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("infiniteCanvas:actionFissionAgentPromptEditTitle")}</DialogTitle>
          <DialogDescription>{t("infiniteCanvas:actionFissionAgentPromptEditDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field className="gap-2">
            <FieldLabel htmlFor="action-fission-agent-prompt-text">
              {t("infiniteCanvas:actionFissionAgentPrompt")}
            </FieldLabel>
            <Textarea
              id="action-fission-agent-prompt-text"
              className="min-h-64 resize-none font-mono text-xs leading-5"
              value={prompt}
              placeholder={t("infiniteCanvas:actionFissionAgentPromptPlaceholder")}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </Field>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">{t("common:actions.cancel")}</Button>
          </DialogClose>
          <Button type="button" disabled={!prompt.trim()} onClick={submit}>
            {t("common:actions.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
