export type PanePreview =
  | null
  | {
      kind: "doc";
      path: string;
      mode: "preview" | "edit";
      dirty: boolean;
      splitRatio: number;
      text: string;
      error?: string;
    }
  | {
      kind: "link";
      url: string;
      splitRatio: number;
      loadError?: boolean;
    };

export const DEFAULT_SPLIT_RATIO = 0.5;

function fileExtension(path: string): string {
  const base = path.replace(/\\/g, "/").split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot).toLowerCase();
}

export function isMarkdownPath(path: string): boolean {
  const ext = fileExtension(path);
  return ext === ".md" || ext === ".markdown";
}

export function isHtmlPath(path: string): boolean {
  const ext = fileExtension(path);
  return ext === ".html" || ext === ".htm";
}

export function defaultDocMode(path: string): "preview" | "edit" {
  return isMarkdownPath(path) ? "preview" : "edit";
}

function splitRatioFromPrev(prev: PanePreview): number {
  if (prev === null) return DEFAULT_SPLIT_RATIO;
  return prev.splitRatio;
}

export function openDocPreview(
  prev: PanePreview,
  path: string,
  text: string,
): PanePreview {
  return {
    kind: "doc",
    path,
    mode: defaultDocMode(path),
    dirty: false,
    splitRatio: splitRatioFromPrev(prev),
    text,
  };
}

export function openLinkPreview(prev: PanePreview, url: string): PanePreview {
  return {
    kind: "link",
    url,
    splitRatio: splitRatioFromPrev(prev),
  };
}
