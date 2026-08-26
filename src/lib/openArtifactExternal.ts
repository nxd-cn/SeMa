import { tui } from "../api/tui";
import { pathToFileUrl } from "./pathToFileUrl";

/** Open an artifact link or file path in the system default browser. */
export async function openArtifactInBrowser(
  kind: "doc" | "link",
  pathOrUrl: string,
): Promise<void> {
  const target = kind === "link" ? pathOrUrl : pathToFileUrl(pathOrUrl);
  await tui.openExternal(target);
}
