import { useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { ImageViewerNavigation } from "../../../lib/ImageViewer";
import { collectImageGeneratorReferences } from "../generation/imageGenerationInputs";
import { useInfiniteCanvasSettings } from "../infiniteCanvasSettings";
import type { NativeCanvasEdge, NativeCanvasNode } from "../nativeCanvas";
import { ReferenceComparisonImageViewer } from "./ReferenceComparisonImageViewer";

interface ImageGeneratorImageViewerProps {
  nodeId: string;
  src: string;
  alt: string;
  onClose: () => void;
  navigation?: ImageViewerNavigation;
}

export function ImageGeneratorImageViewer({
  nodeId,
  src,
  alt,
  onClose,
  navigation,
}: ImageGeneratorImageViewerProps) {
  const { t } = useTranslation();
  const { getEdges, getNodes } = useReactFlow<NativeCanvasNode, NativeCanvasEdge>();
  const { settings, updateSettings } = useInfiniteCanvasSettings();
  const viewerSettings = settings.referenceComparisonViewer;
  const [references] = useState(() => collectImageGeneratorReferences(
    nodeId,
    getNodes(),
    getEdges(),
    t("infiniteCanvas:mainReference"),
  ));
  const [referenceIndex, setReferenceIndex] = useState(0);
  const safeReferenceIndex = Math.min(referenceIndex, Math.max(0, references.length - 1));
  const reference = references[safeReferenceIndex];

  return (
    <ReferenceComparisonImageViewer
      src={src}
      alt={alt}
      ariaLabel={t("infiniteCanvas:viewLargeImage")}
      onClose={onClose}
      actions={[]}
      navigation={navigation}
      reference={reference ? {
        src: reference.imageUrl,
        alt: reference.title || t("infiniteCanvas:mainReference"),
        navigation: {
          index: safeReferenceIndex,
          total: references.length,
          previousLabel: t("infiniteCanvas:previousReferenceImage"),
          nextLabel: t("infiniteCanvas:nextReferenceImage"),
          onPrevious: () => setReferenceIndex((current) => Math.max(0, current - 1)),
          onNext: () => setReferenceIndex((current) => Math.min(references.length - 1, current + 1)),
        },
      } : undefined}
      comparisonEnabled={viewerSettings.referenceComparisonEnabled}
      comparisonLabel={t("infiniteCanvas:referenceComparison")}
      onComparisonEnabledChange={(referenceComparisonEnabled) => updateSettings((current) => ({
        ...current,
        referenceComparisonViewer: {
          ...current.referenceComparisonViewer,
          referenceComparisonEnabled,
        },
      }))}
      referencePanelPercent={viewerSettings.referencePanelPercent}
      onReferencePanelPercentChange={(referencePanelPercent) => updateSettings((current) => {
        const normalizedPercent = Math.max(20, Math.min(80, Math.round(referencePanelPercent)));
        if (normalizedPercent === current.referenceComparisonViewer.referencePanelPercent) return current;
        return {
          ...current,
          referenceComparisonViewer: {
            ...current.referenceComparisonViewer,
            referencePanelPercent: normalizedPercent,
          },
        };
      })}
    />
  );
}
