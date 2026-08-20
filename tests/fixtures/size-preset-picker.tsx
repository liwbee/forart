import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import "../../renderer/src/styles/global.css";
import { TooltipProvider } from "../../renderer/src/components/ui/tooltip";
import { SizePresetPicker } from "../../renderer/src/components/SizePresetPicker";

function Fixture() {
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState("medium");
  return (
    <div style={{ width: 320, padding: 40 }}>
      <SizePresetPicker
        open={open}
        resolution="1K"
        aspectRatio="1:1"
        resolutionOptions={[{ value: "1K", label: "1K" }]}
        aspectRatioOptions={[{ value: "1:1", label: "1:1" }]}
        quality={quality}
        qualityOptions={[
          { value: "low", label: "低" },
          { value: "medium", label: "中" },
          { value: "high", label: "高" },
        ]}
        labels={{ trigger: "分辨率 / 比例", resolution: "分辨率", aspectRatio: "比例", quality: "画质" }}
        onOpenChange={setOpen}
        onResolutionChange={() => undefined}
        onAspectRatioChange={() => undefined}
        onQualityChange={setQuality}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider><Fixture /></TooltipProvider>
  </React.StrictMode>,
);
