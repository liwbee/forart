import { ChevronDown, ChevronUp } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";

interface CollapsibleTagFilterRowProps {
  children: ReactNode;
  expandLabel: string;
  collapseLabel: string;
}

export function CollapsibleTagFilterRow({ children, expandLabel, collapseLabel }: CollapsibleTagFilterRowProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    function updateOverflowing() {
      const element = contentRef.current;
      if (!element) return;
      const lineHeight = Number.parseFloat(getComputedStyle(element).getPropertyValue("--library-tag-row-height")) || 44;
      setOverflowing(element.scrollHeight > lineHeight + 2);
    }

    updateOverflowing();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateOverflowing) : null;
    resizeObserver?.observe(content);
    window.addEventListener("resize", updateOverflowing);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateOverflowing);
    };
  }, [children]);

  return (
    <div className={`library-tag-collapsible${expanded ? " expanded" : ""}${overflowing ? " overflowing" : ""}`}>
      <div ref={contentRef} className="library-tag-collapsible__content">
        {children}
      </div>
      {overflowing ? (
        <Button
          className="library-tag-collapsible__toggle"
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={expanded ? collapseLabel : expandLabel}
          title={expanded ? collapseLabel : expandLabel}
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </Button>
      ) : null}
    </div>
  );
}
