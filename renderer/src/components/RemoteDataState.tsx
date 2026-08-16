import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert, Loader2, LogIn, RefreshCw, ServerCrash, Settings, ShieldAlert, WifiOff } from "lucide-react";
import { useAppStore } from "../app/appStore";
import { openServerLoginDialog } from "../features/server-auth/serverLoginDialogStore";
import type { RequestFailure, RequestFailureKind } from "../lib/requestFailure";
import { cn } from "../lib/utils";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty";

interface RemoteDataStateProps {
  failure: RequestFailure;
  scope?: "page" | "panel" | "node";
  compact?: boolean;
  className?: string;
  onRetry?: () => unknown | Promise<unknown>;
  onOpenSettings?: () => void;
}

const FAILURE_ICONS = {
  unauthenticated: LogIn,
  forbidden: ShieldAlert,
  timeout: WifiOff,
  unavailable: WifiOff,
  server: ServerCrash,
  request: CircleAlert,
  unknown: CircleAlert,
} satisfies Record<RequestFailureKind, typeof CircleAlert>;

export function RemoteDataState({
  failure,
  scope = "page",
  compact = false,
  className,
  onRetry,
  onOpenSettings,
}: RemoteDataStateProps) {
  const { t } = useTranslation();
  const setActiveView = useAppStore((state) => state.setActiveView);
  const [retrying, setRetrying] = useState(false);
  const Icon = FAILURE_ICONS[failure.kind];
  const title = t(`common:remoteData.title.${failure.kind}`);
  const description = t(`common:remoteData.description.${failure.kind}`);
  const canLogin = failure.kind === "unauthenticated" || failure.kind === "forbidden";

  async function retry() {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  function openSettings() {
    if (onOpenSettings) onOpenSettings();
    else setActiveView("settings");
  }

  const actions = (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {canLogin ? (
        <Button size={scope === "node" ? "sm" : "default"} onClick={() => openServerLoginDialog()}>
          <LogIn data-icon="inline-start" aria-hidden="true" />
          {t(failure.kind === "forbidden" ? "common:remoteData.actions.switchAccount" : "common:remoteData.actions.login")}
        </Button>
      ) : null}
      {failure.retryable && onRetry ? (
        <Button size={scope === "node" ? "sm" : "default"} variant={canLogin ? "outline" : "default"} disabled={retrying} onClick={() => void retry()}>
          {retrying
            ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden="true" />
            : <RefreshCw data-icon="inline-start" aria-hidden="true" />}
          {retrying ? t("common:remoteData.actions.retrying") : t("common:remoteData.actions.retry")}
        </Button>
      ) : null}
      {(failure.kind === "unavailable" || failure.kind === "timeout") ? (
        <Button size={scope === "node" ? "sm" : "default"} variant="outline" onClick={openSettings}>
          <Settings data-icon="inline-start" aria-hidden="true" />
          {t("common:remoteData.actions.settings")}
        </Button>
      ) : null}
    </div>
  );

  if (compact) {
    return (
      <Alert variant="destructive" className="my-2">
        <Icon aria-hidden="true" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          <p>{description}</p>
          {actions}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Empty
      className={cn(
        scope === "page" ? "min-h-64 border" : scope === "node" ? "min-h-32 gap-3 border p-4 md:p-4" : "min-h-48 border",
        className,
      )}
      role="alert"
    >
      <EmptyHeader>
        <EmptyMedia variant="icon"><Icon className="text-destructive" aria-hidden="true" /></EmptyMedia>
        <EmptyTitle className={scope === "node" ? "text-base" : undefined}>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>{actions}</EmptyContent>
    </Empty>
  );
}
