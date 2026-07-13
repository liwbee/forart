import { useTranslation } from "react-i18next";
import { Skeleton } from "../components/ui/skeleton";

export function CanvasPageSkeleton() {
  const { t } = useTranslation();
  const loadingLabel = t("common:states.loading");

  return (
    <section className="infinite-canvas-page rf-workspace rf-workspace__tabs" aria-busy="true" aria-label={loadingLabel}>
      <div className="rf-workspace-tabs-scroll pointer-events-none" aria-hidden="true">
        <div className="rf-workspace-tabs">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-8 w-40" />
        </div>
      </div>
      <div className="rf-workspace__content pointer-events-none" aria-hidden="true">
        <div className="flex h-full min-h-0 gap-3 p-3">
          <Skeleton className="h-full w-[240px] shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex h-14 items-center justify-between gap-4 border-b border-border px-4">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-9 w-72 max-w-[40%]" />
            </div>
            <div className="grid grid-cols-3 gap-3 p-4">
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
            </div>
          </div>
        </div>
      </div>
      <span className="sr-only" role="status">{loadingLabel}</span>
    </section>
  );
}
