const imageUrl = new URL("./assets/landscape.png", import.meta.url).href;
const audioUrl = new URL("./assets/preview-tone.wav", import.meta.url).href;
export function previewMediaUrl(kind: string): string | undefined {
  return kind === "image" ? imageUrl : kind === "audio" ? audioUrl : undefined;
}
