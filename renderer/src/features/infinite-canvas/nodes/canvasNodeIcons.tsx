import type { SVGProps } from "react";

/**
 * Node decoration icons that used to come from `@iconify-react/*`.
 *
 * `@iconify/css-react`'s Icon component calls setState inside a mount effect
 * (`setIconData` + `setSubscriber`) and again from a follow-up effect. Every
 * mount therefore schedules an extra render, and when React Flow remounts a
 * node subtree often enough React gives up with "Maximum update depth
 * exceeded", which trips WorkspaceErrorBoundary and blanks the canvas — most
 * visibly right after grouping, because grouping selects the new group node and
 * mounts its resize control.
 *
 * These are static inline SVGs of the same glyphs (pajamas:resize,
 * ri:image-ai-fill): no state, no effects, so they can never join an update
 * loop. Sizing stays with the stylesheet.
 */

export function ResizeHandleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" {...props}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M14.776 4.284a.75.75 0 0 0-1.06-1.06L3.22 13.72a.75.75 0 1 0 1.06 1.06zm0 5a.75.75 0 0 0-1.06-1.06L8.22 13.72a.75.75 0 1 0 1.06 1.06z"
      />
    </svg>
  );
}

export function ImageAiFillIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {...props}>
      <path
        fill="currentColor"
        d="m20.713 8.128l-.246.566a.506.506 0 0 1-.934 0l-.246-.566a4.36 4.36 0 0 0-2.22-2.25l-.759-.339a.53.53 0 0 1 0-.963l.717-.319a4.37 4.37 0 0 0 2.251-2.326l.253-.611a.506.506 0 0 1 .942 0l.253.61a4.37 4.37 0 0 0 2.25 2.327l.718.32a.53.53 0 0 1 0 .962l-.76.338a4.36 4.36 0 0 0-2.219 2.251M2.992 3H14v2H4v14l9.292-9.294a1 1 0 0 1 1.415 0L20 15.01V11h2v9.007a1 1 0 0 1-.992.993H2.992A.993.993 0 0 1 2 20.007V3.993A1 1 0 0 1 2.992 3M8 11a2 2 0 1 1 0-4a2 2 0 0 1 0 4"
      />
    </svg>
  );
}
