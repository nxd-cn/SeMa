import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachImeHeuristic,
  findIsolatedInverseCell,
} from "./imeAnchor";

function makeLine(cells: Array<{ isInverse: () => number }>) {
  return {
    length: cells.length,
    getCell(x: number) {
      return cells[x] || null;
    },
  };
}

function inv(on: number) {
  return { isInverse: () => on };
}

describe("findIsolatedInverseCell", () => {
  it("finds lone inverse caret at col 3 on bottom row", () => {
    const lines = [
      makeLine([inv(0), inv(0), inv(0), inv(1), inv(0)]),
      makeLine([inv(0), inv(0), inv(0), inv(0), inv(0)]),
    ];
    const buf = {
      viewportY: 10,
      getLine(y: number) {
        return lines[y - 10] || null;
      },
    };
    expect(findIsolatedInverseCell(buf, 2, true)).toEqual({
      col: 3,
      row: 0,
    });
  });

  it("returns rightmost edge of full inverse row", () => {
    const line = makeLine([inv(1), inv(1), inv(1), inv(1)]);
    const buf = {
      viewportY: 0,
      getLine() {
        return line;
      },
    };
    expect(findIsolatedInverseCell(buf, 1, true)).toEqual({
      col: 3,
      row: 0,
    });

    const mid = makeLine([inv(1), inv(1), inv(1)]);
    expect(
      findIsolatedInverseCell(
        {
          viewportY: 0,
          getLine() {
            return mid;
          },
        },
        1,
        true
      )
    ).toEqual({ col: 2, row: 0 });

    expect(findIsolatedInverseCell(buf, 1, false)).toEqual({
      col: 3,
      row: 0,
    });
  });

  it("finds caret at end of row with left neighbour normal", () => {
    const line = makeLine([inv(0), inv(0), inv(1)]);
    const buf = {
      viewportY: 5,
      getLine(y: number) {
        return y === 5 ? line : null;
      },
    };
    expect(findIsolatedInverseCell(buf, 1, true)).toEqual({
      col: 2,
      row: 0,
    });
  });
});

describe("attachImeHeuristic", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("no-ops without DOM", () => {
    const d = attachImeHeuristic({
      element: null,
      cols: 1,
      rows: 1,
      buffer: {
        active: {
          viewportY: 0,
          cursorX: 0,
          cursorY: 0,
          getLine: () => null,
        },
      },
    });
    expect(typeof d.detach).toBe("function");
    d.detach();
  });

  it("pins textarea + composition-view to inverse cell on compositionstart", () => {
    const line = makeLine([inv(0), inv(1), inv(0), inv(0)]);
    const styleProps: Record<string, string> = { left: "", top: "" };
    const makeStyle = () => ({
      left: "",
      top: "",
      setProperty(k: string, v: string) {
        styleProps[k] = v;
        (this as { left: string; top: string })[k as "left" | "top"] = v;
      },
    });
    const textarea = {
      style: makeStyle(),
      addEventListener(type: string, fn: () => void) {
        (this as Record<string, unknown>)["on" + type] = fn;
      },
      removeEventListener() {},
    };
    const compositionView = { style: makeStyle() };
    const screen = {
      getBoundingClientRect() {
        return { width: 80, height: 20 };
      },
    };
    const root = {
      querySelector(sel: string) {
        if (sel === ".xterm-helper-textarea") return textarea;
        if (sel === ".xterm-screen") return screen;
        if (sel === ".composition-view") return compositionView;
        return null;
      },
    };
    const terminal = {
      element: root as unknown as HTMLElement,
      cols: 4,
      rows: 1,
      buffer: {
        active: {
          viewportY: 0,
          cursorX: 3,
          cursorY: 0,
          getLine() {
            return line;
          },
        },
      },
      onRender() {
        return { dispose() {} };
      },
    };

    vi.stubGlobal(
      "MutationObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );

    const anchors: Array<{ source: string; col: number }> = [];
    const handle = attachImeHeuristic(terminal, {
      onAnchor: (a) => anchors.push(a),
    });
    (textarea as unknown as { oncompositionstart: () => void }).oncompositionstart();
    expect(textarea.style.left).toBe("20px"); // col 1 * (80/4)
    expect(textarea.style.top).toBe("0px");
    expect(compositionView.style.left).toBe("20px");
    expect(anchors.some((a) => a.source === "heuristic" && a.col === 1)).toBe(
      true
    );
    (textarea as unknown as { oncompositionend: () => void }).oncompositionend();
    handle.detach();
  });
});
