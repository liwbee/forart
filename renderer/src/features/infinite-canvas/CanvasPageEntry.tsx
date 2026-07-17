import type { ComponentProps } from "react";
import { CanvasWorkspacePage } from "./CanvasWorkspacePage";
import { InfiniteCanvasSettingsProvider } from "./infiniteCanvasSettings";

export function CanvasPageEntry(props: ComponentProps<typeof CanvasWorkspacePage>) {
  return (
    <InfiniteCanvasSettingsProvider>
      <CanvasWorkspacePage {...props} />
    </InfiniteCanvasSettingsProvider>
  );
}

export { CanvasWorkspacePage };
export default CanvasPageEntry;
