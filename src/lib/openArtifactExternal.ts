import { tui } from "../api/tui";
import { parentDirOfFile } from "./parentDirOfFile";
import { pathToFileUrl } from "./pathToFileUrl";

/** Open an artifact link or file path in the system default browser. */
export async function openArtifactInBrowser(
  kind: "doc" | "link",
  pathOrUrl: string,
): Promise<void> {
  const target = kind === "link" ? pathOrUrl : pathToFileUrl(pathOrUrl);
  await tui.openExternal(target);
}

/**
 * Row-side “打开”: link → system browser; doc → containing folder
 * (Finder / Explorer via `open_path`).
 */
export async function openArtifactInSystem(
  kind: "doc" | "link",
  pathOrUrl: string,
): Promise<void> {
  if (kind === "link") {
    await tui.openExternal(pathOrUrl);
    return;
  }
  const dir = parentDirOfFile(pathOrUrl);
  if (!dir) {
    throw new Error("no parent directory");
  }
  await tui.openPath(dir);
}
