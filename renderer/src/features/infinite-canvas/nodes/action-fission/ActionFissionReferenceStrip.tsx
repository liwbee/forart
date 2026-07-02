import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { ReferenceImageStrip, ReferenceImageUploadButton } from "../../components/ReferenceImageStrip";
import { useActionFissionPromptPreviews, useActionFissionReferencePreviews } from "../../action-fission/useActionFissionReferencePreviews";

interface ActionFissionReferenceStripProps {
  nodeId: string;
  draggedInputConnectionId: string;
  onRemoveInput: (connectionId: string) => void;
  onReorderInput: (nodeId: string, connectionId: string, imageInsertIndex: number) => void;
  onCreateImageReference: (nodeId: string, files: FileList | File[]) => void;
  onDraggedInputConnectionIdChange: (connectionId: string) => void;
}

export function ActionFissionReferenceStrip({
  nodeId,
  draggedInputConnectionId,
  onRemoveInput,
  onReorderInput,
  onCreateImageReference,
  onDraggedInputConnectionIdChange,
}: ActionFissionReferenceStripProps) {
  const { t } = useTranslation();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const promptPreviews = useActionFissionPromptPreviews(nodeId);
  const publicImagePreviews = useActionFissionReferencePreviews(nodeId);

  return (
    <div className="ic-action-fission-refs">
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          if (event.target.files?.length) onCreateImageReference(nodeId, event.target.files);
          event.target.value = "";
        }}
      />
      <ReferenceImageStrip
        targetId={nodeId}
        promptItems={promptPreviews}
        imageItems={publicImagePreviews}
        draggedConnectionId={draggedInputConnectionId}
        className="ic-action-fission-refs__list"
        uploadButton={(
          <ReferenceImageUploadButton
            ariaLabel={t("common:actions.uploadImage")}
            title={t("common:actions.uploadImage")}
            onClick={() => uploadInputRef.current?.click()}
          />
        )}
        deleteLabel={t("infiniteCanvas:deleteConnection")}
        onRemove={onRemoveInput}
        onReorder={onReorderInput}
        onDraggedConnectionIdChange={onDraggedInputConnectionIdChange}
      />
    </div>
  );
}
