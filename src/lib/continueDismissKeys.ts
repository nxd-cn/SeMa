export function chatSubmitKeyAction(ev: {
  type?: string;
  key?: string;
  code?: string;
  keyCode?: number;
  which?: number;
  isComposing?: boolean;
} | null): "submit" | null {
  if (!ev || ev.type !== "keydown") return null;
  if (ev.isComposing) return null;
  const keyCode = Number(ev.keyCode || ev.which || 0);
  if (keyCode === 229) return null;
  const key = String(ev.key || "");
  const code = String(ev.code || "");
  const isEnter =
    key === "Enter" ||
    code === "Enter" ||
    code === "NumpadEnter" ||
    keyCode === 13;
  if (!isEnter) return null;
  return "submit";
}

export function dataLooksLikeSubmit(data: unknown): boolean {
  if (data == null) return false;
  const s = typeof data === "string" ? data : String(data);
  return (
    s === "\r" ||
    s === "\n" ||
    s.indexOf("\r") !== -1 ||
    s.indexOf("\n") !== -1
  );
}
