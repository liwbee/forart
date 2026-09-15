import { Skeleton } from "../../../components/ui/skeleton";
import { cn } from "../../../lib/utils";

/** Shared visual treatment for assets that are being uploaded or prepared. */
export function AssetUploadPlaceholder({ className, label }: { className?: string; label: string }) {
  return (
    <div className={cn("rf-asset-upload-placeholder", className)} role="status" aria-live="polite" aria-label={label}>
      <Skeleton className="rf-asset-upload-placeholder__surface" />
    </div>
  );
}
