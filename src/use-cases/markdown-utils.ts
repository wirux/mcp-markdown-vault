export function sanitizeForMarkdown(text: string): string {
  return text.replace(/[`[\]]/g, (c) => `\\${c}`);
}
