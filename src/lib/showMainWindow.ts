import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * Show the initially hidden main window after the first paint (Windows:
 * avoids WebView2 white flash). Harmless on macOS where the window starts visible.
 */
export function showMainWindowAfterPaint(): void {
  const show = () => {
    void getCurrentWebviewWindow()
      .show()
      .catch(() => {
        /* non-Tauri / capability missing — ignore in tests */
      });
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(show);
  });
}
