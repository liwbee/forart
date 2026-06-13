export type ImageGeneratorInputPreview =
  | { id: string; connectionId: string; kind: "image"; order: number; title: string; url: string }
  | { id: string; connectionId: string; kind: "prompt"; title: string; text: string };
