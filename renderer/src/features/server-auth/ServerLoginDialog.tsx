import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ForartAppConfig } from "../../app/appConfig";
import { Button } from "../../components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import { useServerLoginDialogStore } from "./serverLoginDialogStore";

interface ServerLoginDialogProps {
  config: ForartAppConfig;
  onConfigChange: (config: ForartAppConfig) => void;
}

export function ServerLoginDialog({ config, onConfigChange }: ServerLoginDialogProps) {
  const { t } = useTranslation();
  const open = useServerLoginDialogStore((state) => state.open);
  const request = useServerLoginDialogStore((state) => state.request);
  const closeDialog = useServerLoginDialogStore((state) => state.closeDialog);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const serverUrl = String(request.serverUrl || config.serverUrl || "").trim();

  useEffect(() => {
    if (!open) return;
    setUsername(String(request.username || config.serverAuthUsername || ""));
    setPassword("");
    setErrorMessage("");
  }, [config.serverAuthUsername, open, request.username]);

  async function submitLogin() {
    if (!serverUrl || !username.trim() || !password) {
      setErrorMessage(t("settings:remoteLoginRequired"));
      return;
    }
    setErrorMessage("");
    setBusy(true);
    try {
      const result = await window.forartConfig?.serverLogin({ serverUrl, username, password });
      if (!result?.ok || !result.config) throw new Error(result?.error || t("settings:remoteLoginFailed"));
      onConfigChange(result.config);
      closeDialog();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (busy || nextOpen) return;
        closeDialog();
      }}
    >
      <DialogContent>
        <form onSubmit={(event) => { event.preventDefault(); void submitLogin(); }}>
          <DialogHeader>
            <DialogTitle>{t("settings:serverLoginTitle")}</DialogTitle>
            <DialogDescription>{t("settings:serverLoginDescription")}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="mt-5 gap-4">
            <Field data-invalid={Boolean(errorMessage && !username.trim())}>
              <FieldLabel htmlFor="server-login-username">{t("settings:serverUsername")}</FieldLabel>
              <Input
                id="server-login-username"
                value={username}
                onChange={(event) => { setUsername(event.target.value); setErrorMessage(""); }}
                placeholder={t("settings:serverUsernamePlaceholder")}
                autoComplete="username"
                aria-invalid={Boolean(errorMessage && !username.trim())}
                disabled={busy}
              />
            </Field>
            <Field data-invalid={Boolean(errorMessage && !password)}>
              <FieldLabel htmlFor="server-login-password">{t("settings:serverPassword")}</FieldLabel>
              <Input
                id="server-login-password"
                value={password}
                onChange={(event) => { setPassword(event.target.value); setErrorMessage(""); }}
                type="password"
                placeholder={t("settings:serverPasswordPlaceholder")}
                autoComplete="current-password"
                aria-invalid={Boolean(errorMessage && !password)}
                disabled={busy}
              />
            </Field>
            <FieldError>{errorMessage}</FieldError>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={busy}>{t("common:actions.cancel")}</Button>
            </DialogClose>
            <Button type="submit" disabled={busy}>{busy ? t("settings:loggingIn") : t("settings:login")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
