import * as React from "react";

import { cn } from "../lib/utils";
import { ScrollArea, type ScrollAreaProps } from "./ui/scroll-area";

type AppScrollAreaProps = ScrollAreaProps;

export const AppScrollArea = React.forwardRef<HTMLDivElement, AppScrollAreaProps>(function AppScrollArea({
  className,
  viewportClassName,
  scrollbars = "vertical",
  ...props
}, ref) {
  return (
    <ScrollArea
      ref={ref}
      className={cn("min-h-0 min-w-0", className)}
      viewportClassName={cn("min-h-0 min-w-0", viewportClassName)}
      scrollbars={scrollbars}
      {...props}
    />
  );
});

export type { AppScrollAreaProps };
