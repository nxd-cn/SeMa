import type { RefObject } from "react";
import ChromeScrollbar from "./ChromeScrollbar";

type Props = {
  scrollRef: RefObject<HTMLElement | null>;
  layoutKey: string;
};

/** Vertical chrome scrollbar — same colors as term-hscroll (Win + Mac). */
export default function ChromeVScrollbar({ scrollRef, layoutKey }: Props) {
  return (
    <ChromeScrollbar
      axis="y"
      scrollRef={scrollRef}
      layoutKey={layoutKey}
      trackClassName="chrome-vscroll"
      thumbClassName="chrome-vscroll-thumb"
      overflowParentClass="is-v-overflow"
    />
  );
}
