import { useEffect, useRef, useState } from "react";
import type { DocArtifact, LinkArtifact } from "../api/tui";
import { artifactsSummaryLabel } from "../lib/artifactsSummary";
import ChromeVScrollbar from "./ChromeVScrollbar";

type Props = {
  cliId: string;
  cwd: string;
  cliSessionId?: string | null;
  docs: DocArtifact[];
  links: LinkArtifact[];
  loading?: boolean;
  onToggleExpand: (expanded: boolean) => void;
  expanded: boolean;
  onOpenDoc: (path: string) => void;
  onOpenLink: (url: string) => void;
};

export default function PaneArtifacts({
  cliId: _cliId,
  cwd: _cwd,
  cliSessionId,
  docs,
  links,
  loading,
  onToggleExpand,
  expanded,
  onOpenDoc,
  onOpenLink,
}: Props) {
  const [missingPaths, setMissingPaths] = useState<Set<string>>(() => new Set());
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const layoutKey = `${docs.length}:${links.length}:${expanded ? 1 : 0}`;

  useEffect(() => {
    const live = new Set(docs.map((d) => d.path));
    setMissingPaths((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const path of prev) {
        if (live.has(path)) next.add(path);
        else changed = true;
      }
      if (!changed && next.size === prev.size) return prev;
      return next;
    });
  }, [docs]);

  if (!cliSessionId) return null;
  if (docs.length + links.length === 0 && !expanded && !loading) return null;

  const markMissing = (path: string) => {
    setMissingPaths((prev) => {
      if (prev.has(path)) return prev;
      const next = new Set(prev);
      next.add(path);
      return next;
    });
  };

  const openDoc = (path: string) => {
    if (missingPaths.has(path)) return;
    void Promise.resolve(onOpenDoc(path)).catch(() => markMissing(path));
  };

  return (
    <div className="pane-artifacts" aria-busy={loading ? true : undefined}>
      <button
        type="button"
        className="pane-artifacts-summary"
        aria-expanded={expanded}
        onClick={() => onToggleExpand(!expanded)}
      >
        <span className="pane-artifacts-chevron" aria-hidden="true">
          {expanded ? "▾" : "▸"}
        </span>
        {artifactsSummaryLabel(docs.length, links.length)}
      </button>
      {expanded ? (
        <div className="pane-artifacts-body-shell chrome-vscroll-shell">
          <div ref={bodyRef} className="pane-artifacts-body chrome-vscroll-port">
            {docs.length > 0 ? (
              <>
                <div className="pane-artifacts-section-title">文档</div>
                {docs.map((doc) => {
                  const missing = missingPaths.has(doc.path);
                  return (
                    <a
                      key={doc.path}
                      className={`pane-artifacts-item${missing ? " is-missing" : ""}`}
                      href={missing ? undefined : "#"}
                      title={doc.path}
                      onClick={(e) => {
                        e.preventDefault();
                        openDoc(doc.path);
                      }}
                    >
                      {doc.label}
                    </a>
                  );
                })}
              </>
            ) : null}
            {links.length > 0 ? (
              <>
                <div className="pane-artifacts-section-title">链接</div>
                {links.map((link) => (
                  <a
                    key={link.url}
                    className="pane-artifacts-item"
                    href={link.url}
                    title={link.url}
                    onClick={(e) => {
                      e.preventDefault();
                      onOpenLink(link.url);
                    }}
                  >
                    {link.label || link.url}
                  </a>
                ))}
              </>
            ) : null}
            {loading && docs.length + links.length === 0 ? (
              <div className="pane-artifacts-section-title">加载中…</div>
            ) : null}
          </div>
          <ChromeVScrollbar scrollRef={bodyRef} layoutKey={layoutKey} />
        </div>
      ) : null}
    </div>
  );
}
