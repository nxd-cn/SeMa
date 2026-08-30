import { describe, expect, it, vi } from "vitest";
import {
  applyInkHardwareCursorLock,
  attachInkHardwareCursorLock,
  inkHardwareCursorDrifted,
  type InkCursorLockTerminal,
} from "./lockInkHardwareCursor";

describe("inkHardwareCursorDrifted", () => {
  it("is false for bar + no blink", () => {
    expect(
      inkHardwareCursorDrifted({ cursorStyle: "bar", cursorBlink: false })
    ).toBe(false);
  });

  it("is true for block or blink", () => {
    expect(
      inkHardwareCursorDrifted({ cursorStyle: "block", cursorBlink: false })
    ).toBe(true);
    expect(
      inkHardwareCursorDrifted({ cursorStyle: "bar", cursorBlink: true })
    ).toBe(true);
  });
});

describe("applyInkHardwareCursorLock", () => {
  it("forces bar and non-blink", () => {
    const opts = { cursorStyle: "block", cursorBlink: true };
    expect(applyInkHardwareCursorLock(opts)).toEqual({
      cursorStyle: "bar",
      cursorBlink: false,
    });
    expect(opts).toEqual({ cursorStyle: "bar", cursorBlink: false });
  });
});

describe("attachInkHardwareCursorLock", () => {
  function mockTerm(
    initial: { cursorStyle: string; cursorBlink: boolean } = {
      cursorStyle: "underline",
      cursorBlink: true,
    }
  ): InkCursorLockTerminal & {
    _csiCb: ((params: (number | number[])[]) => boolean) | null;
    _renderCb: (() => void) | null;
  } {
    const term = {
      options: { ...initial },
      _csiCb: null as ((params: (number | number[])[]) => boolean) | null,
      _renderCb: null as (() => void) | null,
      parser: {
        registerCsiHandler: vi.fn(
          (
            _id: { intermediates?: string; final: string },
            cb: (params: (number | number[])[]) => boolean
          ) => {
            term._csiCb = cb;
            return { dispose: vi.fn() };
          }
        ),
      },
      onRender: vi.fn((cb: () => void) => {
        term._renderCb = cb;
        return { dispose: vi.fn() };
      }),
    };
    return term;
  }

  it("applies lock immediately and swallows DECSCUSR", () => {
    const term = mockTerm();
    attachInkHardwareCursorLock(term);
    expect(term.options).toEqual({ cursorStyle: "bar", cursorBlink: false });
    expect(term.parser.registerCsiHandler).toHaveBeenCalledWith(
      { intermediates: " ", final: "q" },
      expect.any(Function)
    );
    expect(term._csiCb?.([])).toBe(true);
  });

  it("re-asserts on render after options drift", () => {
    const term = mockTerm({ cursorStyle: "bar", cursorBlink: false });
    attachInkHardwareCursorLock(term);
    term.options.cursorStyle = "block";
    term.options.cursorBlink = true;
    term._renderCb?.();
    expect(term.options).toEqual({ cursorStyle: "bar", cursorBlink: false });
  });

  it("detaches CSI and render listeners", () => {
    const term = mockTerm();
    const handle = attachInkHardwareCursorLock(term);
    const csiDisp = (
      term.parser.registerCsiHandler as ReturnType<typeof vi.fn>
    ).mock.results[0].value;
    const renderDisp = (term.onRender as ReturnType<typeof vi.fn>).mock
      .results[0].value;
    handle.detach();
    expect(csiDisp.dispose).toHaveBeenCalledOnce();
    expect(renderDisp.dispose).toHaveBeenCalledOnce();
  });
});
