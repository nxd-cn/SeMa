/**
 * Parent directory of a file path for Finder / Explorer (`open_path`).
 * Handles Windows `\` and POSIX `/`. Empty string if no parent.
 */
export function parentDirOfFile(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed) return "";

  const usedBackslash = trimmed.includes("\\");
  const normalized = trimmed.replace(/\\/g, "/");
  const stripped = normalized.replace(/\/+$/, "");
  if (!stripped) return usedBackslash ? "" : "/";

  const idx = stripped.lastIndexOf("/");
  if (idx < 0) return "";
  if (idx === 0) return "/";

  let parent = stripped.slice(0, idx);
  // `C:/file` → `C:/` (drive root must stay a directory path)
  if (/^[A-Za-z]:$/.test(parent)) {
    parent = `${parent}/`;
  }

  if (usedBackslash && !trimmed.includes("/")) {
    return parent.replace(/\//g, "\\");
  }
  return parent;
}
