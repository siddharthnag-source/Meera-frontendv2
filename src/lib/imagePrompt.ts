// src/lib/imagePrompt.ts
const IMAGE_TRIGGERS = ["image", "photo", "picture", "img", "pic"];

export function isImagePrompt(text: string | null | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return IMAGE_TRIGGERS.some((t) => new RegExp("\\b" + t + "\\b", "i").test(lower));
}
