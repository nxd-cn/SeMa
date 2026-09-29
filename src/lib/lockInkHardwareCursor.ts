/**
 * Keep xterm hardware cursor as invisible bar for Ink AI CLIs.
 *
 * Ink draws the real caret as an inverse-video cell. SeMa hides the hardware
 * cursor with `cursorStyle: "bar"` + bg-matched cursor color. CLIs can still
 * emit DECSCUSR (`CSI Ps SP q`) and flip style to `block`; DomRenderer then
 * paints `background-color: cursor !important` and erases the Ink caret —
 * typing still works, cursor looks gone. Swallow DECSCUSR and re-assert bar /
 * non-blink on render (also covers ATT610 blink mode 12).
 */

export type InkCursorLockTerminal = {
  options: {
    /** Matches xterm `ITerminalOptions` (optional until set). */
    cursorStyle?: string;
    cursorBlink?: boolean;
  };
  parser: {
    registerCsiHandler: (
      id: { prefix?: string; intermediates?: string; final: string },
      callback: (params: (number | number[])[]) => boolean
    ) => { dispose: () => void };
  };
  onRender: (callback: () => void) => { dispose: () => void };
};

export function inkHardwareCursorDrifted(opts: {
  cursorStyle?: string;
  cursorBlink?: boolean;
}): boolean {
  return opts.cursorStyle !== "bar" || !!opts.cursorBlink;
}

export function applyInkHardwareCursorLock(opts: {
  cursorStyle?: string;
  cursorBlink?: boolean;
  blink?: boolean;
}): { cursorStyle: "bar"; cursorBlink: boolean } {
  const blink = !!opts.blink;
  opts.cursorStyle = "bar";
  opts.cursorBlink = blink;
  return { cursorStyle: "bar", cursorBlink: blink };
}

export type InkCursorLockHandle = { detach: () => void };

export function attachInkHardwareCursorLock(
  term: InkCursorLockTerminal,
  opts?: { blink?: boolean }
): InkCursorLockHandle {
  const targetBlink = !!opts?.blink;
  applyInkHardwareCursorLock({ ...term.options, blink: targetBlink });
  term.options.cursorStyle = "bar";
  term.options.cursorBlink = targetBlink;

  const csi = term.parser.registerCsiHandler(
    { intermediates: " ", final: "q" },
    () => true
  );

  const render = term.onRender(() => {
    if (
      term.options.cursorStyle !== "bar" ||
      !!term.options.cursorBlink !== targetBlink
    ) {
      term.options.cursorStyle = "bar";
      term.options.cursorBlink = targetBlink;
    }
  });

  return {
    detach() {
      csi.dispose();
      render.dispose();
    },
  };
}
