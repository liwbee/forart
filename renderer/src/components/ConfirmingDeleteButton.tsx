import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Check, Trash2, X } from "lucide-react";
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ConfirmingDeleteButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "onClick"> & {
  label: ReactNode;
  confirmLabel: ReactNode;
  busyLabel?: ReactNode;
  icon?: ReactNode;
  confirmIcon?: ReactNode;
  cancelLabel?: string;
  isBusy?: boolean;
  resetKey?: string | number;
  autoResetMs?: number;
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
  onConfirmStateChange?: (confirming: boolean) => void;
  onDelete: () => void | Promise<void>;
};

const sizeVariants = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-10 px-6 text-base",
};

const iconSizeVariants = {
  sm: "size-3",
  md: "size-4",
  lg: "size-5",
};

const cancelButtonSizes = {
  sm: "size-8",
  md: "size-9",
  lg: "size-10",
};

const smoothSpring = {
  type: "spring" as const,
  bounce: 0,
  duration: 0.35,
};

export function ConfirmingDeleteButton({
  label,
  confirmLabel,
  busyLabel,
  icon,
  confirmIcon,
  cancelLabel = "Cancel delete",
  isBusy = false,
  resetKey,
  autoResetMs = 3000,
  size = "md",
  showIcon = true,
  onConfirmStateChange,
  onDelete,
  className,
  disabled,
  type = "button",
  ...props
}: ConfirmingDeleteButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const effectiveDisabled = disabled || isBusy;

  useEffect(() => {
    setConfirming(false);
  }, [resetKey]);

  useEffect(() => {
    if (!confirming || autoResetMs <= 0) return undefined;
    const timeout = window.setTimeout(() => setConfirming(false), autoResetMs);
    return () => window.clearTimeout(timeout);
  }, [autoResetMs, confirming]);

  useEffect(() => {
    onConfirmStateChange?.(confirming);
  }, [confirming, onConfirmStateChange]);

  function handleMainClick() {
    if (effectiveDisabled) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    void onDelete();
  }

  return (
    <MotionConfig transition={smoothSpring}>
      <motion.div
        layout
        className={cn("relative inline-flex shrink-0 flex-nowrap items-center gap-2 whitespace-nowrap", className, confirming && "confirming")}
        data-confirming={confirming ? "true" : undefined}
      >
        <motion.div layout className="shrink-0" whileHover={!effectiveDisabled ? { scale: 1.02 } : undefined} whileTap={!effectiveDisabled ? { scale: 0.98 } : undefined}>
          <Button
            {...props}
            variant="destructive"
            size="default"
            className={cn(sizeVariants[size], "cursor-pointer", effectiveDisabled && "cursor-not-allowed opacity-50")}
            type={type}
            disabled={effectiveDisabled}
            aria-label={props["aria-label"] ?? (confirming ? String(confirmLabel) : String(label))}
            onClick={handleMainClick}
          >
            <AnimatePresence mode="wait" initial={false}>
              {showIcon ? (
                <motion.span
                  key={confirming ? "check-icon" : "trash-icon"}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.15 }}
                  className="mr-1 flex items-center"
                >
                  {confirming ? confirmIcon ?? <Check className={iconSizeVariants[size]} /> : icon ?? <Trash2 className={iconSizeVariants[size]} />}
                </motion.span>
              ) : null}
            </AnimatePresence>
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                className="whitespace-nowrap"
                key={confirming ? "confirm" : "delete"}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
              >
                {isBusy && busyLabel ? busyLabel : confirming ? confirmLabel : label}
              </motion.span>
            </AnimatePresence>
          </Button>
        </motion.div>

        <AnimatePresence mode="popLayout">
          {confirming ? (
            <motion.div
              key="cancel-button"
              className="shrink-0"
              layout
              initial={{ opacity: 0, scale: 0.8, x: -8 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.8, x: -8 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Button
                variant="ghost"
                size="icon"
                className={cn(cancelButtonSizes[size], "cursor-pointer")}
                type="button"
                aria-label={cancelLabel}
                onClick={() => setConfirming(false)}
              >
                <X className={iconSizeVariants[size]} />
              </Button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
    </MotionConfig>
  );
}
