import { marked } from "marked";

/** Sync HTML for Chat / pane preview. Empty string on parse failure. */
export function renderMarkdown(text: string): string {
  try {
    return marked.parse(text || "", { async: false }) as string;
  } catch {
    return "";
  }
}
