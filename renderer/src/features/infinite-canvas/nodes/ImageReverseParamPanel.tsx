import { NodeToolbar, Position, useEdges, useNodes, useStore } from "@xyflow/react";
import { CircleAlert, Maximize2, Minimize2, Play, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppSelect } from "../../../components/AppSelect";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Card, CardContent } from "../../../components/ui/card";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { useCanvasAgent } from "../../canvas-agent";
import { API_PROVIDER_CHANGED_EVENT, getModelDisplayName, isChatProviderConfigured, loadApiSettings, orderedApiProviders, readApiSettings, type ApiSettings } from "../../settings/apiProviders";
import { useInfiniteCanvasSettings } from "../infiniteCanvasSettings";
import { useNativeCanvasActions } from "../canvasActions";
import { collectImageGeneratorPrompts, collectSmartReverseReferences } from "../generation/imageGenerationInputs";
import { smartReverseResultText } from "../generation/imageReverseResult";
import type { NativeCanvasEdge, NativeCanvasNode, NativeSmartReverseResult } from "../nativeCanvas";
import { ImageReferenceStrip } from "./ImageReferenceStrip";
import { ImagePromptEditor } from "./ImagePromptEditor";
import { normalizeImagePromptDocument } from "../generation/imagePromptReferences";
import { useSmartReverseRuntimeStore } from "../generation/imageReverseRuntimeStore";

type ReasoningEffort = NonNullable<NativeCanvasNode["data"]["smartReverseReasoning"]>;

export function SmartReverseParamPanel({ nodeId, data, visible }: { nodeId: string; data: NativeCanvasNode["data"]; visible: boolean }) {
  const { t } = useTranslation();
  const offset = useStore((state) => state.transform[2]) * 20;
  const nodes = useNodes<NativeCanvasNode>();
  const edges = useEdges<NativeCanvasEdge>();
  const actions = useNativeCanvasActions();
  const agent = useCanvasAgent();
  const { settings: infiniteCanvasSettings, updateSettings: updateInfiniteCanvasSettings } = useInfiniteCanvasSettings();
  const promptExpanded = infiniteCanvasSettings.promptEditorsExpanded;
  const [apiSettings, setApiSettings] = useState<ApiSettings>(() => readApiSettings());
  const [localRunning, setLocalRunning] = useState(false);
  const [error, setError] = useState("");
  const activeRunIdRef = useRef("");
  const handledRunIdRef = useRef("");
  const runControllerRef = useRef<() => void>(() => undefined);
  const stopControllerRef = useRef<() => void>(() => undefined);
  const setRuntimeRunning = useSmartReverseRuntimeStore((state) => state.setRunning);
  const registerRuntime = useSmartReverseRuntimeStore((state) => state.register);
  const unregisterRuntime = useSmartReverseRuntimeStore((state) => state.unregister);
  const matchingRun = useMemo(() => Object.values(agent.runs)
    .filter((run) => run.nodeId === nodeId && run.task === "smart-reverse")
    .sort((left, right) => Number(right.startedAt || 0) - Number(left.startedAt || 0))[0], [agent.runs, nodeId]);
  const running = localRunning || matchingRun?.status === "running";

  useEffect(() => {
    if (!matchingRun) return;
    if (matchingRun.status === "running") {
      activeRunIdRef.current = matchingRun.runId;
      setLocalRunning(true);
      setRuntimeRunning(nodeId, true);
      return;
    }
    if (handledRunIdRef.current === matchingRun.runId) return;
    handledRunIdRef.current = matchingRun.runId;
    if (activeRunIdRef.current === matchingRun.runId) activeRunIdRef.current = "";
    setLocalRunning(false);
    setRuntimeRunning(nodeId, false);
    if (matchingRun.status === "completed" && matchingRun.result) {
      const result = matchingRun.result as NativeSmartReverseResult;
      actions.patchNodeData(nodeId, { smartReverseResult: result, text: smartReverseResultText(result) });
    } else if (matchingRun.status === "failed" && matchingRun.error) {
      setError(matchingRun.error);
    }
  }, [actions, matchingRun, nodeId, setRuntimeRunning]);

  useEffect(() => {
    if (!visible) return;
    const sync = () => setApiSettings(readApiSettings());
    window.addEventListener(API_PROVIDER_CHANGED_EVENT, sync);
    void loadApiSettings().then(setApiSettings).catch(() => undefined);
    return () => window.removeEventListener(API_PROVIDER_CHANGED_EVENT, sync);
  }, [visible]);

  const references = useMemo(() => collectSmartReverseReferences(nodeId, nodes, edges, t("infiniteCanvas:referenceImage")), [edges, nodeId, nodes, t]);
  const promptInputs = useMemo(() => collectImageGeneratorPrompts(nodeId, nodes, edges, t("infiniteCanvas:prompt")), [edges, nodeId, nodes, t]);
  const providers = useMemo(() => orderedApiProviders(apiSettings.providers, apiSettings.providerOrder).filter(isChatProviderConfigured), [apiSettings.providerOrder, apiSettings.providers]);
  const provider = providers.find((item) => item.id === data.smartReverseProviderId) || providers[0] || null;
  const model = provider?.chatModels.includes(String(data.smartReverseModel || "")) ? String(data.smartReverseModel) : provider?.chatModels[0] || "";
  const reasoning = data.smartReverseReasoning || "none";

  async function run() {
    if (running || !provider || !model || !references.length) return;
    const snapshot = references.map((item) => ({ ...item }));
    let runId = "";
    setLocalRunning(true); setRuntimeRunning(nodeId, true); setError("");
    try {
      const instructionParts = [
        String(data.smartReverseInstruction || "").trim(),
        ...promptInputs.map((item) => item.text.trim()),
      ].filter(Boolean);
      const response = await agent.run({ task: "smart-reverse", nodeId, reasoning, modelRoute: { providerId: provider.id, model }, context: { instruction: instructionParts.join("\n\n"), assets: snapshot }, onRunId: (nextRunId) => { runId = nextRunId; activeRunIdRef.current = nextRunId; } });
      const nextResult = response.result as NativeSmartReverseResult;
      actions.patchNodeData(nodeId, { smartReverseProviderId: provider.id, smartReverseModel: model, smartReverseReasoning: reasoning, smartReverseResult: nextResult, text: smartReverseResultText(nextResult) });
    } catch (runError) {
      if (activeRunIdRef.current === runId) setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      if (activeRunIdRef.current === runId) {
        activeRunIdRef.current = "";
        setLocalRunning(false);
        setRuntimeRunning(nodeId, false);
      }
    }
  }

  async function stop() {
    if (!activeRunIdRef.current) return;
    const runId = activeRunIdRef.current;
    activeRunIdRef.current = "";
    await agent.cancel(runId);
    setLocalRunning(false); setRuntimeRunning(nodeId, false);
  }

  runControllerRef.current = () => { void run(); };
  stopControllerRef.current = () => { void stop(); };
  useEffect(() => {
    registerRuntime(nodeId, { run: () => runControllerRef.current(), stop: () => stopControllerRef.current() });
    return () => unregisterRuntime(nodeId);
  }, [nodeId, registerRuntime, unregisterRuntime]);

  return (
    <NodeToolbar nodeId={nodeId} isVisible={visible} position={Position.Bottom} offset={offset}>
      <Card className="nodrag nopan nowheel relative w-[min(40rem,calc(100vw-2rem))] gap-0 rounded-md border-border/40 py-0 shadow-sm">
        <Button
          type="button"
          variant="outline"
          size="icon-micro"
          className="absolute -right-px -top-px z-10 translate-x-1/2 -translate-y-1/2 rounded-full border-border/40 bg-card shadow-sm hover:bg-card dark:bg-card dark:hover:bg-card active:-translate-y-1/2"
          aria-label={t(promptExpanded ? "infiniteCanvas:collapsePromptEditor" : "infiniteCanvas:expandPromptEditor")}
          title={t(promptExpanded ? "infiniteCanvas:collapsePromptEditor" : "infiniteCanvas:expandPromptEditor")}
          aria-controls={`smart-reverse-instruction-${nodeId}`}
          aria-expanded={promptExpanded}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => updateInfiniteCanvasSettings((current) => ({
            ...current,
            promptEditorsExpanded: !current.promptEditorsExpanded,
          }))}
        >
          {promptExpanded
            ? <Minimize2 aria-hidden="true" />
            : <Maximize2 aria-hidden="true" />}
        </Button>
        <ScrollArea className={promptExpanded
          ? "max-h-[calc(100vh-4rem)]"
          : "max-h-[min(32rem,calc(100vh-4rem))]"}>
          <CardContent className="p-2">
          <div className="grid gap-4">
            <ImageReferenceStrip
              prompts={promptInputs} items={references} supported onRemove={actions.removeCanvasEdge} onReorder={(ids) => actions.reorderImageGeneratorReferences(nodeId, ids)}
            />
            <ImagePromptEditor id={`smart-reverse-instruction-${nodeId}`} value={String(data.smartReverseInstruction || "")} document={normalizeImagePromptDocument(data.smartReverseInstructionDocument)} references={references} placeholder={t("infiniteCanvas:smartReverseInstructionPlaceholder")} ariaLabel={t("infiniteCanvas:smartReverseInstruction")} expanded={promptExpanded} onFocusChange={() => undefined} onCompositionChange={() => undefined} onCommit={() => undefined} onChange={(value, document) => actions.patchNodeDataSilently(nodeId, { smartReverseInstruction: value, smartReverseInstructionDocument: document })} />
            <div className="flex w-max min-w-full max-w-[calc(100vw-4rem-2px)] items-end gap-2">
              <div className="grid w-max min-w-0 gap-1">
                <span className="pl-2 text-[9px] font-medium leading-none text-muted-foreground">{t("infiniteCanvas:platform")}</span>
                <AppSelect variant="ghost" size="sm" triggerTextSize="sm" className="w-max min-w-0" value={provider?.id || ""} options={providers.map((item) => ({ value: item.id, label: item.name }))} ariaLabel={t("infiniteCanvas:platform")} disabled={running || !providers.length} onChange={(id) => { const next = providers.find((item) => item.id === id); actions.patchNodeData(nodeId, { smartReverseProviderId: id, smartReverseModel: next?.chatModels[0] || "" }); }} />
              </div>
              <div className="grid w-max min-w-0 gap-1">
                <span className="pl-2 text-[9px] font-medium leading-none text-muted-foreground">{t("infiniteCanvas:model")}</span>
                <AppSelect variant="ghost" size="sm" triggerTextSize="sm" className="w-max min-w-0" value={model} options={(provider?.chatModels || []).map((item) => ({ value: item, label: getModelDisplayName(provider, "chat", item) }))} ariaLabel={t("infiniteCanvas:model")} disabled={running || !provider} onChange={(next) => actions.patchNodeData(nodeId, { smartReverseProviderId: provider?.id, smartReverseModel: next })} />
              </div>
              <div className="grid w-max min-w-0 gap-1">
                <span className="pl-2 text-[9px] font-medium leading-none text-muted-foreground">{t("infiniteCanvas:reasoningLevel")}</span>
                <AppSelect variant="ghost" size="sm" triggerTextSize="sm" className="w-max min-w-0" value={reasoning} options={[
              { value: "none", label: t("infiniteCanvas:reasoningNone") },
              { value: "minimal", label: t("infiniteCanvas:reasoningMinimal") },
              { value: "low", label: t("infiniteCanvas:reasoningLow") },
              { value: "medium", label: t("infiniteCanvas:reasoningMedium") },
              { value: "high", label: t("infiniteCanvas:reasoningHigh") },
              { value: "xhigh", label: t("infiniteCanvas:reasoningXhigh") },
              { value: "max", label: t("infiniteCanvas:reasoningMax") },
                ]} ariaLabel={t("infiniteCanvas:reasoningLevel")} disabled={running} onChange={(next) => actions.patchNodeData(nodeId, { smartReverseReasoning: next as ReasoningEffort })} />
              </div>
              <span className="min-w-0 flex-1" data-parameter-panel-spacer aria-hidden="true" />
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t(running ? "infiniteCanvas:stopRun" : "infiniteCanvas:run")} title={t(running ? "infiniteCanvas:stopRun" : "infiniteCanvas:run")} disabled={(!running && (!provider || !model || !references.length))} onClick={() => void (running ? stop() : run())}>{running ? <Square aria-hidden="true" fill="currentColor" /> : <Play aria-hidden="true" fill="currentColor" />}</Button>
            </div>
            {!providers.length ? <Alert><CircleAlert aria-hidden="true" /><AlertDescription>{t("infiniteCanvas:noChatApiConfigured")}</AlertDescription></Alert> : null}
            {error ? <Alert variant="destructive"><CircleAlert aria-hidden="true" /><AlertDescription>{error}</AlertDescription></Alert> : null}
          </div>
          </CardContent>
        </ScrollArea>
      </Card>
    </NodeToolbar>
  );
}
