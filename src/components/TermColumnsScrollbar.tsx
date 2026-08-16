import type { RefObject } from "react";
import ChromeScrollbar from "./ChromeScrollbar";

type Props = {
  scrollRef: RefObject<HTMLElement | null>;
  layoutKey: string;
};

/** Horizontal chrome scrollbar for #term-columns. */
export default function TermColumnsScrollbar({
  scrollRef,
  layoutKey,
}: Props) {
  return (
    <ChromeScrollbar
      axis="x"
      scrollRef={scrollRef}
      layoutKey={layoutKey}
      trackClassName="term-hscroll"
      thumbClassName="term-hscroll-thumb"
      overflowParentClass="is-h-overflow"
    />
  );
}
