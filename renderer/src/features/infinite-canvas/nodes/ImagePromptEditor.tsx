import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  DecoratorNode,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../../components/ui/button";
import { Popover, PopoverAnchor, PopoverContent, PopoverTitle } from "../../../components/ui/popover";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import {
  findImageReferenceMentionQuery,
  formatImageReferenceLabel,
  normalizeImagePromptDocument,
  serializeImagePromptForDisplay,
} from "../generation/imagePromptReferences";
import type { ImageGeneratorReferenceInput } from "../generation/imageGenerationInputs";
import type { NativeImagePromptDocument } from "../nativeCanvas";

type SerializedImageReferenceNode = Spread<{
  edgeId: string;
  type: "image-reference";
  version: 1;
}, SerializedLexicalNode>;

interface ReferenceContextValue {
  references: ImageGeneratorReferenceInput[];
  referenceLabel: (index: number) => string;
  invalidLabel: string;
}

interface MentionQuery {
  nodeKey: string;
  start: number;
  length: number;
  query: string;
}

interface ImagePromptEditorProps {
  id: string;
  value: string;
  document?: NativeImagePromptDocument;
  references: ImageGeneratorReferenceInput[];
  placeholder: string;
  ariaLabel: string;
  onChange: (value: string, document: NativeImagePromptDocument) => void;
  onCommit: () => void;
  onFocusChange: (focused: boolean) => void;
  onCompositionChange: (composing: boolean) => void;
}

const ImagePromptReferenceContext = createContext<ReferenceContextValue | null>(null);

function ImageReferenceToken({ edgeId }: { edgeId: string }) {
  const context = useContext(ImagePromptReferenceContext);
  const index = context?.references.findIndex((reference) => reference.edgeId === edgeId) ?? -1;
  const valid = index >= 0;
  const reference = valid ? context?.references[index] : undefined;
  const token = (
    <span
      className={valid ? "rf-image-prompt-reference-token" : "rf-image-prompt-reference-token is-invalid"}
      aria-label={valid ? context?.referenceLabel(index) : context?.invalidLabel}
      contentEditable={false}
    >
      {reference?.previewUrl ? (
        <img
          className="rf-image-prompt-reference-thumbnail"
          src={reference.previewUrl}
          alt=""
          draggable={false}
        />
      ) : null}
      {valid ? context?.referenceLabel(index) : context?.invalidLabel}
    </span>
  );
  if (!reference?.previewUrl) return token;
  return (
    <Tooltip delayDuration={250}>
      <TooltipTrigger asChild>{token}</TooltipTrigger>
      <TooltipContent className="rf-image-prompt-reference-preview" side="top" sideOffset={6}>
        <img src={reference.previewUrl} alt="" draggable={false} />
      </TooltipContent>
    </Tooltip>
  );
}

export class ImageReferenceNode extends DecoratorNode<JSX.Element> {
  __edgeId: string;

  static getType() {
    return "image-reference";
  }

  static clone(node: ImageReferenceNode) {
    return new ImageReferenceNode(node.__edgeId, node.__key);
  }

  static importJSON(serializedNode: SerializedImageReferenceNode) {
    return $createImageReferenceNode(serializedNode.edgeId);
  }

  constructor(edgeId: string, key?: NodeKey) {
    super(key);
    this.__edgeId = edgeId;
  }

  exportJSON(): SerializedImageReferenceNode {
    return {
      ...super.exportJSON(),
      edgeId: this.__edgeId,
      type: "image-reference",
      version: 1,
    };
  }

  createDOM() {
    return document.createElement("span");
  }

  updateDOM() {
    return false;
  }

  isInline() {
    return true;
  }

  getTextContent() {
    return "@";
  }

  decorate() {
    return <ImageReferenceToken edgeId={this.__edgeId} />;
  }
}

export function $createImageReferenceNode(edgeId: string) {
  return new ImageReferenceNode(edgeId);
}

export function $isImageReferenceNode(node: LexicalNode | null | undefined): node is ImageReferenceNode {
  return node instanceof ImageReferenceNode;
}

function readMentionQuery(): MentionQuery | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed() || selection.anchor.type !== "text") return null;
  const node = $getNodeByKey(selection.anchor.key);
  if (!$isTextNode(node)) return null;
  const offset = selection.anchor.offset;
  const prefix = node.getTextContent().slice(0, offset);
  const trigger = findImageReferenceMentionQuery(prefix);
  if (!trigger) return null;
  return {
    nodeKey: node.getKey(),
    ...trigger,
  };
}

function insertReference(editor: LexicalEditor, query: MentionQuery, edgeId: string) {
  editor.update(() => {
    const node = $getNodeByKey(query.nodeKey);
    if (!$isTextNode(node)) return;
    node.spliceText(query.start, query.length, "");
    node.select(query.start, query.start);
    $insertNodes([$createImageReferenceNode(edgeId), $createTextNode(" ")]);
  });
}

function MentionPickerPlugin({ references }: { references: ImageGeneratorReferenceInput[] }) {
  const [editor] = useLexicalComposerContext();
  const context = useContext(ImagePromptReferenceContext);
  const { t } = useTranslation();
  const [query, setQuery] = useState<MentionQuery | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const filteredReferences = useMemo(() => {
    if (!query) return [];
    const normalizedQuery = query.query.trim().toLocaleLowerCase();
    return references.filter((_, index) => (
      !normalizedQuery || context?.referenceLabel(index).toLocaleLowerCase().includes(normalizedQuery)
    ));
  }, [context, query, references]);
  const open = Boolean(query && filteredReferences.length);

  const chooseReference = useCallback((index: number) => {
    const reference = filteredReferences[index];
    if (!query || !reference) return;
    insertReference(editor, query, reference.edgeId);
    setQuery(null);
  }, [editor, filteredReferences, query]);

  useEffect(() => editor.registerUpdateListener(({ editorState }) => {
    editorState.read(() => {
      const nextQuery = references.length ? readMentionQuery() : null;
      setQuery(nextQuery);
      setActiveIndex((current) => nextQuery ? Math.min(current, Math.max(0, references.length - 1)) : 0);
    });
  }), [editor, references.length]);

  useEffect(() => {
    if (!open) return undefined;
    const unregister = [
      editor.registerCommand(KEY_ARROW_DOWN_COMMAND, () => {
        setActiveIndex((current) => (current + 1) % filteredReferences.length);
        return true;
      }, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_ARROW_UP_COMMAND, () => {
        setActiveIndex((current) => (current - 1 + filteredReferences.length) % filteredReferences.length);
        return true;
      }, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_ENTER_COMMAND, () => {
        chooseReference(Math.min(activeIndex, filteredReferences.length - 1));
        return true;
      }, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_TAB_COMMAND, () => {
        chooseReference(Math.min(activeIndex, filteredReferences.length - 1));
        return true;
      }, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_ESCAPE_COMMAND, () => {
        setQuery(null);
        return true;
      }, COMMAND_PRIORITY_HIGH),
    ];
    return () => unregister.forEach((dispose) => dispose());
  }, [activeIndex, chooseReference, editor, filteredReferences.length, open]);

  if (!open) return null;
  return (
    <PopoverContent
      id="image-prompt-reference-picker"
      className="w-[min(22rem,calc(100vw-2rem))] p-1"
      align="start"
      side="top"
      sideOffset={6}
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => event.preventDefault()}
      onPointerDown={(event) => event.preventDefault()}
    >
      <PopoverTitle className="sr-only">{t("infiniteCanvas:referenceMentionList")}</PopoverTitle>
      <ScrollArea className="max-h-56">
        <div className="flex flex-col gap-1">
          {filteredReferences.map((reference, index) => (
            <Button
              key={reference.edgeId}
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start px-2 py-1.5"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => chooseReference(index)}
            >
              <img className="size-8 shrink-0 rounded-sm object-cover" src={reference.previewUrl} alt="" draggable={false} />
              <span className="min-w-0 flex-1 truncate text-left">{context?.referenceLabel(references.indexOf(reference))}</span>
            </Button>
          ))}
        </div>
      </ScrollArea>
    </PopoverContent>
  );
}

function ExternalStateSyncPlugin({
  document,
  fallbackText,
  focused,
}: {
  document?: NativeImagePromptDocument;
  fallbackText: string;
  focused: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  const externalSignature = useMemo(() => JSON.stringify(document || null), [document]);

  useEffect(() => {
    if (focused) return;
    const current = JSON.stringify(editor.getEditorState().toJSON());
    if (document) {
      if (current === externalSignature) return;
      editor.setEditorState(editor.parseEditorState(JSON.stringify(document)), { tag: "external-sync" });
      return;
    }
    editor.update(() => {
      const root = $getRoot();
      if (root.getTextContent() === fallbackText) return;
      root.clear();
      root.append($createParagraphNode().append($createTextNode(fallbackText)));
    }, { tag: "external-sync" });
  }, [document, editor, externalSignature, fallbackText, focused]);
  return null;
}

export function ImagePromptEditor({
  id,
  value,
  document,
  references,
  placeholder,
  ariaLabel,
  onChange,
  onCommit,
  onFocusChange,
  onCompositionChange,
}: ImagePromptEditorProps) {
  const { t, i18n } = useTranslation();
  const [focused, setFocused] = useState(false);
  const latestDocumentRef = useRef(document);
  const referenceLabel = useCallback(
    (index: number) => formatImageReferenceLabel(index, i18n.resolvedLanguage || i18n.language),
    [i18n.language, i18n.resolvedLanguage],
  );
  const contextValue = useMemo<ReferenceContextValue>(() => ({
    references,
    referenceLabel,
    invalidLabel: t("infiniteCanvas:invalidImageReference"),
  }), [referenceLabel, references, t]);
  useEffect(() => {
    latestDocumentRef.current = document;
  }, [document]);
  useEffect(() => {
    const currentDocument = latestDocumentRef.current;
    if (!currentDocument) return;
    const nextValue = serializeImagePromptForDisplay({
      document: currentDocument,
      references,
      referenceLabel,
      missingReferenceLabel: t("infiniteCanvas:invalidImageReference"),
    });
    if (nextValue !== value) onChange(nextValue, currentDocument);
  }, [onChange, referenceLabel, references, t, value]);
  const initialDocument = normalizeImagePromptDocument(document);
  const initialConfig = useMemo(() => ({
    namespace: `image-prompt-${id}`,
    nodes: [ImageReferenceNode],
    onError(error: Error) {
      throw error;
    },
    editorState: initialDocument
      ? JSON.stringify(initialDocument)
      : () => {
        const root = $getRoot();
        root.append($createParagraphNode().append($createTextNode(value)));
      },
  // Only the first document initializes Lexical; later updates use ExternalStateSyncPlugin.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [id]);

  return (
    <ImagePromptReferenceContext.Provider value={contextValue}>
      <Popover open={focused}>
        <LexicalComposer initialConfig={initialConfig}>
          <PopoverAnchor asChild>
            <div className="rf-image-generator-prompt-shell">
              <PlainTextPlugin
                contentEditable={(
                  <ContentEditable
                    id={id}
                    className="rf-image-generator-prompt"
                    aria-label={ariaLabel}
                    aria-autocomplete="list"
                    onFocus={() => {
                      setFocused(true);
                      onFocusChange(true);
                    }}
                    onBlur={() => {
                      setFocused(false);
                      onFocusChange(false);
                      onCommit();
                    }}
                    onCompositionStart={() => onCompositionChange(true)}
                    onCompositionEnd={() => onCompositionChange(false)}
                  />
                )}
                placeholder={<div className="rf-image-generator-prompt-placeholder">{placeholder}</div>}
                ErrorBoundary={LexicalErrorBoundary}
              />
            </div>
          </PopoverAnchor>
          <HistoryPlugin />
          <OnChangePlugin
            onChange={(editorState, _editor, tags) => {
              if (tags.has("external-sync")) return;
              const nextDocument = normalizeImagePromptDocument(editorState.toJSON());
              if (!nextDocument) return;
              latestDocumentRef.current = nextDocument;
              const plainText = serializeImagePromptForDisplay({
                document: nextDocument,
                references,
                referenceLabel,
                missingReferenceLabel: t("infiniteCanvas:invalidImageReference"),
              });
              onChange(plainText, nextDocument);
            }}
          />
          <ExternalStateSyncPlugin document={document} fallbackText={value} focused={focused} />
          <MentionPickerPlugin references={references} />
        </LexicalComposer>
      </Popover>
    </ImagePromptReferenceContext.Provider>
  );
}
