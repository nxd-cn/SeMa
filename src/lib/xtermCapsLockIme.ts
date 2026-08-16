/**
 * Mac CapsLock 中/英 during CJK composition: xterm 5.5 early-finalizes then
 * compositionend sends again → duplicate text (#5282).
 *
 * The first send is on CapsLock keydown (before compositionend), so dedupe
 * must arm at compositionstart. Mac-only — Windows must not run this filter.
 */

type DedupeOpts = {
  windowMs?: number;
  now?: () => number;
};

/**
 * Armed for the whole composition + a short tail after compositionend.
 * Drops a second identical onData (or a single "asdasd" burst).
 */
export function createCompositionCommitDedupe(opts?: DedupeOpts) {
  const windowMs = opts?.windowMs ?? 100;
  const now = opts?.now ?? (() => performance.now());
  let live = false;
  let until = 0;
  let first: string | null = null;

  const active = () => live || now() < until;

  const filterData = (data: string): string | null => {
    if (!active()) {
      first = null;
      return data;
    }
    if (data.length >= 2 && data.length % 2 === 0) {
      const half = data.slice(0, data.length / 2);
      if (half.length > 0 && half + half === data) {
        if (first === null) {
          first = half;
          return half;
        }
        if (half === first || data === first || data === first + first) {
          return null;
        }
      }
    }
    if (first === null) {
      first = data;
      return data;
    }
    if (data === first || data === first + first) return null;
    return data;
  };

  return {
    noteCompositionStart() {
      live = true;
      until = 0;
      first = null;
    },
    noteCompositionEnd() {
      live = false;
      until = now() + windowMs;
    },
    allowData(data: string): boolean {
      return filterData(data) !== null;
    },
    filterData,
  };
}

type TermLike = {
  textarea?: HTMLTextAreaElement | null;
};

/** Attach Mac-only composition commit dedupe to an opened xterm Terminal. */
export function attachCapsLockImeFix(term: TermLike): {
  detach: () => void;
  filterData: (data: string) => string | null;
} {
  const dedupe = createCompositionCommitDedupe();
  const textarea = term.textarea;
  const onStart = () => dedupe.noteCompositionStart();
  const onEnd = () => dedupe.noteCompositionEnd();

  textarea?.addEventListener("compositionstart", onStart);
  textarea?.addEventListener("compositionend", onEnd);

  return {
    filterData: (data) => dedupe.filterData(data),
    detach() {
      textarea?.removeEventListener("compositionstart", onStart);
      textarea?.removeEventListener("compositionend", onEnd);
    },
  };
}
