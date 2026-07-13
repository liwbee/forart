import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Collapsible, CollapsibleContent } from "../../../components/ui/collapsible";
import { cn } from "../../../lib/utils";

interface CanvasFloatingPanelProps {
  open: boolean;
  title: ReactNode;
  className?: string;
  children: ReactNode;
}

export function CanvasFloatingPanel({ open, title, className, children }: CanvasFloatingPanelProps) {
  return (
    <Collapsible open={open}>
      <CollapsibleContent className={cn("canvas-floating-panel canvas-floating-panel__collapsible", className)}>
        <Card
          className="canvas-floating-panel__card nodrag nopan nowheel"
          role="region"
          aria-label={typeof title === "string" ? title : undefined}
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <CardHeader className="sr-only">
            <CardTitle>{title}</CardTitle>
          </CardHeader>
          <CardContent className="canvas-floating-panel__content">
            {children}
          </CardContent>
        </Card>
      </CollapsibleContent>
    </Collapsible>
  );
}
