import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import "../../renderer/src/i18n";
import "../../renderer/src/styles/global.css";
import { TooltipProvider } from "../../renderer/src/components/ui/tooltip";
import { ReferenceComparisonImageViewer } from "../../renderer/src/features/infinite-canvas/nodes/ReferenceComparisonImageViewer";

function imageData(label: string, width: number, height: number, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${color}"/><circle cx="50%" cy="38%" r="18%" fill="#f5f5f5"/><rect x="31%" y="58%" width="38%" height="30%" rx="20" fill="#f5f5f5"/><text x="50%" y="95%" fill="#111" font-family="sans-serif" font-size="28" text-anchor="middle">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const results = Array.from({ length: 6 }, (_, index) => imageData(`Result ${index + 1}`, 768, 1024, index % 2 ? "#cbd5e1" : "#dbeafe"));
const reference = imageData("Reference 1", 1024, 768, "#fee2e2");

function Fixture() {
  const [resultIndex, setResultIndex] = useState(0);
  const [comparisonEnabled, setComparisonEnabled] = useState(true);
  const [referencePanelPercent, setReferencePanelPercent] = useState(50);

  return (
    <ReferenceComparisonImageViewer
      src={results[resultIndex]}
      alt={`Result ${resultIndex + 1}`}
      ariaLabel="Action fission result viewer"
      onClose={() => undefined}
      actions={[]}
      comparisonEnabled={comparisonEnabled}
      comparisonLabel="Reference comparison"
      onComparisonEnabledChange={setComparisonEnabled}
      referencePanelPercent={referencePanelPercent}
      onReferencePanelPercentChange={setReferencePanelPercent}
      reference={{
        src: reference,
        alt: "Reference 1",
        navigation: {
          index: 0,
          total: 1,
          previousLabel: "Previous reference",
          nextLabel: "Next reference",
          onPrevious: () => undefined,
          onNext: () => undefined,
        },
      }}
      navigation={{
        index: resultIndex,
        total: results.length,
        previousLabel: "Previous result",
        nextLabel: "Next result",
        onPrevious: () => setResultIndex((index) => Math.max(0, index - 1)),
        onNext: () => setResultIndex((index) => Math.min(results.length - 1, index + 1)),
      }}
    />
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider>
      <Fixture />
    </TooltipProvider>
  </React.StrictMode>,
);
