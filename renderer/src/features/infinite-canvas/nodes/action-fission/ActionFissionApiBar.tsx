import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Select } from "../../../../components/Select";
import type { ApiProvider } from "../../../settings/apiProviders";
import { detectImageModelRuleId, getImageModelRule, normalizeImageModelSizeSelection } from "../../../settings/imageModelRules";
import type { ActionFissionState } from "../../action-fission/actionFissionTypes";
import { listLibtvWorkspaces } from "../../libtv-generation/libtvGenerationApi";
import type { LibtvWorkspaceRecord } from "../../libtv-generation/libtvGenerationTypes";

interface ActionFissionApiBarProps {
  nodeId: string;
  state: ActionFissionState;
  selectedProvider: ApiProvider | null;
  imageProviders: ApiProvider[];
  openSelectId: string;
  onOpenSelectChange: (selectId: string) => void;
  onSetApiType: (apiType: NonNullable<ActionFissionState["apiType"]>) => void;
  onSetModel: (model: string, providerId: string, sizePatch?: Pick<ActionFissionState, "resolution" | "aspectRatio">) => void;
  onSetLibtvWorkspace: (workspaceId: string, workspaceName: string) => void;
}

function selectId(nodeId: string, name: string) {
  return `${nodeId}:action-fission:${name}`;
}

export function ActionFissionApiBar({
  nodeId,
  state,
  selectedProvider,
  imageProviders,
  openSelectId,
  onOpenSelectChange,
  onSetApiType,
  onSetModel,
  onSetLibtvWorkspace,
}: ActionFissionApiBarProps) {
  const { t } = useTranslation();
  const [libtvWorkspaces, setLibtvWorkspaces] = useState<LibtvWorkspaceRecord[]>([]);
  const isLibtvApi = state.apiType === "libtv-api";
  const loadSeqRef = useRef(0);
  const workspaceIdRef = useRef(state.libtvWorkspaceId || "");
  const setWorkspaceRef = useRef(onSetLibtvWorkspace);

  useEffect(() => {
    workspaceIdRef.current = state.libtvWorkspaceId || "";
    setWorkspaceRef.current = onSetLibtvWorkspace;
  });

  const loadLibtvWorkspaces = useCallback(() => {
    const seq = ++loadSeqRef.current;
    return listLibtvWorkspaces()
      .then((result) => {
        if (loadSeqRef.current !== seq) return [];
        const workspaces = result.workspaces || [];
        setLibtvWorkspaces(workspaces);
        return workspaces;
      })
      .catch(() => {
        if (loadSeqRef.current !== seq) return [];
        setLibtvWorkspaces([]);
        return [];
      });
  }, []);

  useEffect(() => {
    if (!isLibtvApi) return;
    let canceled = false;
    void loadLibtvWorkspaces().then((workspaces) => {
      if (canceled) return;
      const currentWorkspaceId = workspaceIdRef.current;
      const hasCurrentWorkspace = workspaces.some((workspace) => workspace.id === currentWorkspaceId);
      const firstWorkspace = workspaces[0];
      if ((!currentWorkspaceId || !hasCurrentWorkspace) && firstWorkspace) {
        setWorkspaceRef.current(firstWorkspace.id, firstWorkspace.name || "");
      }
    });
    return () => {
      canceled = true;
    };
  }, [isLibtvApi, loadLibtvWorkspaces]);

  const apiOptions = [
    ...imageProviders.map((provider) => ({ value: provider.id, label: provider.name || provider.id })),
    { value: "libtv-api", label: "LibTV" },
  ];
  const workspaceOptions = libtvWorkspaces.length
    ? libtvWorkspaces.map((workspace) => ({ value: workspace.id, label: workspace.name || workspace.id }))
    : [{ value: "", label: t("infiniteCanvas:libtvNoWorkspaces") }];

  const renderSelect = (name: string, ariaLabel: string, value: string, options: Array<{ value: string; label: string; hint?: string }>, onChange: (value: string) => void) => {
    const id = selectId(nodeId, name);
    return (
      <Select
        value={value}
        options={options}
        ariaLabel={ariaLabel}
        open={openSelectId === id}
        onOpenChange={(open) => {
          onOpenSelectChange(open ? id : "");
          if (open && name === "libtv-workspace") void loadLibtvWorkspaces();
        }}
        onChange={onChange}
        menuPlacement="bottom"
        maxMenuHeight={170}
      />
    );
  };

  return (
    <div className={`ic-action-fission-api-bar${isLibtvApi ? " is-libtv" : ""}`}>
      {renderSelect(
        "api",
        t("infiniteCanvas:platform"),
        isLibtvApi ? "libtv-api" : selectedProvider?.id || "",
        apiOptions,
        (value) => {
          if (value === "libtv-api") {
            onSetApiType("libtv-api");
            return;
          }
          const provider = imageProviders.find((item) => item.id === value) || null;
          const nextModel = provider?.imageModels.includes(state.model || "") ? state.model || "" : provider?.imageModels[0] || "";
          const nextRule = provider && nextModel ? getImageModelRule(provider.modelRules.image[nextModel] || detectImageModelRuleId(nextModel)) : getImageModelRule("generic-image");
          const nextSize = normalizeImageModelSizeSelection(nextRule, state.resolution, state.aspectRatio);
          onSetApiType("third-party-api");
          onSetModel(nextModel, provider?.id || "", nextSize);
        },
      )}
      {isLibtvApi ? renderSelect(
        "libtv-workspace",
        t("infiniteCanvas:libtvWorkspace"),
        state.libtvWorkspaceId || "",
        workspaceOptions,
        (value) => {
          const workspace = libtvWorkspaces.find((item) => item.id === value);
          onSetLibtvWorkspace(value, workspace?.name || "");
        },
      ) : null}
    </div>
  );
}
