import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { DocArtifact, LinkArtifact } from "../api/tui";
import {
  openArtifactInBrowser,
  openArtifactInSystem,
} from "../lib/openArtifactExternal";
import { placeArtifactsDropdown } from "../lib/artifactDropdownPlace";
import type { ArtifactsMenuKind } from "../lib/usePaneArtifacts";
import ChromeVScrollbar from "./ChromeVScrollbar";
import { FileIcon, FolderIcon, GlobeIcon } from "./PaneArtifactsIcons";

type ArtifactCtx = {
  x: number;
  y: number;
  kind: "doc" | "link";
  target: string;
  disabled?: boolean;
} | null;

type Props = {
  cliSessionId?: string | null;
  docs: DocArtifact[];
  links: LinkArtifact[];
  loading?: boolean;
  openMenu: ArtifactsMenuKind;
  onToggleMenu: (kind: ArtifactsMenuKind) => void;
  onOpenDoc: (path: string) => void;
  onOpenLink: (url: string) => void;
};

function ArtifactContextMenu({
  menu,
  onClose,
  onOpen,
}: {
  menu: ArtifactCtx;
  onClose: () => void;
  onOpen: () => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onDown = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu, onClose]);

  useEffect(() => {
    if (!menu || !elRef.current) return;
    const el = elRef.current;
    const pad = 4;
    const w = el.offsetWidth || 120;
    const h = el.offsetHeight || 40;
    const left = Math.min(menu.x, window.innerWidth - w - pad);
    const top = Math.min(menu.y, window.innerHeight - h - pad);
    el.style.left = `${Math.max(pad, left)}px`;
    el.style.top = `${Math.max(pad, top)}px`;
  }, [menu]);

  if (!menu) return null;

  return (
    <div
      ref={elRef}
      className="term-ctx pane-artifacts-ctx"
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        role="menuitem"
        disabled={menu.disabled}
        onClick={() => {
          if (menu.disabled) return;
          onOpen();
          onClose();
        }}
      >
        Open
      </button>
    </div>
  );
}

type DropdownProps = {
  kind: "docs" | "links";
  docs: DocArtifact[];
  links: LinkArtifact[];
  loading?: boolean;
  missingPaths: Set<string>;
  onOpenDoc: (path: string) => void;
  onOpenLink: (url: string) => void;
  onOpenInSystem: (kind: "doc" | "link", target: string) => void;
  onContextMenu: (
    e: React.MouseEvent,
    kind: "doc" | "link",
    target: string,
    disabled?: boolean,
  ) => void;
  onPick: () => void;
  onDocError: (path: string) => void;
};

const ArtifactsDropdown = forwardRef<HTMLDivElement, DropdownProps>(
  function ArtifactsDropdown(
    {
      kind,
      docs,
      links,
      loading,
      missingPaths,
      onOpenDoc,
      onOpenLink,
      onOpenInSystem,
      onContextMenu,
      onPick,
      onDocError,
    },
    ref,
  ) {
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const layoutKey = `${kind}:${docs.length}:${links.length}`;

    const openDoc = (path: string) => {
      if (missingPaths.has(path)) return;
      onPick();
      void Promise.resolve(onOpenDoc(path)).catch(() => onDocError(path));
    };

    return (
      <div
        ref={ref}
        className="pane-artifacts-dropdown is-portal"
        role="menu"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="pane-artifacts-dropdown-shell chrome-vscroll-shell">
          <div
            ref={bodyRef}
            className="pane-artifacts-dropdown-body chrome-vscroll-port"
          >
            {kind === "docs" ? (
              docs.length > 0 ? (
                docs.map((doc) => {
                  const missing = missingPaths.has(doc.path);
                  return (
                    <div
                      key={doc.path}
                      role="menuitem"
                      className={`pane-artifacts-item${missing ? " is-missing" : ""}`}
                      title={doc.path}
                      onContextMenu={(e) =>
                        onContextMenu(e, "doc", doc.path, missing)
                      }
                    >
                      <button
                        type="button"
                        className="pane-artifacts-item-main"
                        disabled={missing}
                        onClick={() => openDoc(doc.path)}
                      >
                        {doc.label}
                      </button>
                      <button
                        type="button"
                        className="pane-artifacts-item-open"
                        title="打开所在文件夹"
                        aria-label="打开所在文件夹"
                        disabled={missing}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (missing) return;
                          onOpenInSystem("doc", doc.path);
                        }}
                      >
                        <FolderIcon />
                      </button>
                    </div>
                  );
                })
              ) : loading ? (
                <div className="pane-artifacts-empty">加载中…</div>
              ) : (
                <div className="pane-artifacts-empty">暂无文档</div>
              )
            ) : links.length > 0 ? (
              links.map((link) => (
                <div
                  key={link.url}
                  role="menuitem"
                  className="pane-artifacts-item"
                  title={link.url}
                  onContextMenu={(e) => onContextMenu(e, "link", link.url)}
                >
                  <button
                    type="button"
                    className="pane-artifacts-item-main"
                    onClick={() => {
                      onPick();
                      onOpenLink(link.url);
                    }}
                  >
                    {link.label || link.url}
                  </button>
                  <button
                    type="button"
                    className="pane-artifacts-item-open"
                    title="在浏览器打开"
                    aria-label="在浏览器打开"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenInSystem("link", link.url);
                    }}
                  >
                    <GlobeIcon />
                  </button>
                </div>
              ))
            ) : loading ? (
              <div className="pane-artifacts-empty">加载中…</div>
            ) : (
              <div className="pane-artifacts-empty">暂无链接</div>
            )}
          </div>
          <ChromeVScrollbar scrollRef={bodyRef} layoutKey={layoutKey} />
        </div>
      </div>
    );
  },
);

export default function PaneArtifacts({
  cliSessionId,
  docs,
  links,
  loading,
  openMenu,
  onToggleMenu,
  onOpenDoc,
  onOpenLink,
}: Props) {
  const [missingPaths, setMissingPaths] = useState<Set<string>>(() => new Set());
  const [ctxMenu, setCtxMenu] = useState<ArtifactCtx>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const docsBtnRef = useRef<HTMLButtonElement>(null);
  const linksBtnRef = useRef<HTMLButtonElement>(null);

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

  useLayoutEffect(() => {
    if (!openMenu || !dropdownRef.current) return;
    const anchor =
      openMenu === "docs" ? docsBtnRef.current : linksBtnRef.current;
    if (!anchor) return;
    const panel = dropdownRef.current;
    const place = () => placeArtifactsDropdown(anchor, panel);
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [openMenu, docs.length, links.length, loading]);

  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (toolbarRef.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      onToggleMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggleMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openMenu, onToggleMenu]);

  const markMissing = useCallback((path: string) => {
    setMissingPaths((prev) => {
      if (prev.has(path)) return prev;
      const next = new Set(prev);
      next.add(path);
      return next;
    });
  }, []);

  const showCtx = (
    e: React.MouseEvent,
    kind: "doc" | "link",
    target: string,
    disabled = false,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, kind, target, disabled });
  };

  const openExternal = () => {
    const menu = ctxMenu;
    if (!menu || menu.disabled) return;
    void openArtifactInBrowser(menu.kind, menu.target).catch(() => {
      if (menu.kind === "doc") markMissing(menu.target);
    });
  };

  const openInSystem = useCallback(
    (kind: "doc" | "link", target: string) => {
      void openArtifactInSystem(kind, target).catch(() => {
        if (kind === "doc") markMissing(target);
      });
    },
    [markMissing],
  );

  if (!cliSessionId) return null;

  const showDocs = docs.length > 0 || openMenu === "docs";
  const showLinks = links.length > 0 || openMenu === "links";
  if (!showDocs && !showLinks && !loading) return null;

  const closeMenu = () => onToggleMenu(null);

  const dropdown =
    openMenu != null ? (
      <ArtifactsDropdown
        ref={dropdownRef}
        kind={openMenu}
        docs={docs}
        links={links}
        loading={loading}
        missingPaths={missingPaths}
        onOpenDoc={onOpenDoc}
        onOpenLink={onOpenLink}
        onOpenInSystem={openInSystem}
        onContextMenu={showCtx}
        onPick={closeMenu}
        onDocError={markMissing}
      />
    ) : null;

  return (
    <>
      <div
        ref={toolbarRef}
        className="pane-artifacts-toolbar"
        aria-busy={loading ? true : undefined}
      >
        {showDocs ? (
          <div className="pane-artifacts-trigger-wrap">
            <button
              ref={docsBtnRef}
              type="button"
              className={`pane-artifacts-icon-btn${openMenu === "docs" ? " is-open" : ""}`}
              title="文档"
              aria-label={`文档 ${docs.length}`}
              aria-expanded={openMenu === "docs"}
              aria-haspopup="menu"
              onClick={(e) => {
                e.stopPropagation();
                onToggleMenu(openMenu === "docs" ? null : "docs");
              }}
            >
              <FileIcon />
              <span className="pane-artifacts-count">{docs.length}</span>
            </button>
          </div>
        ) : null}
        {showLinks ? (
          <div className="pane-artifacts-trigger-wrap">
            <button
              ref={linksBtnRef}
              type="button"
              className={`pane-artifacts-icon-btn${openMenu === "links" ? " is-open" : ""}`}
              title="链接"
              aria-label={`链接 ${links.length}`}
              aria-expanded={openMenu === "links"}
              aria-haspopup="menu"
              onClick={(e) => {
                e.stopPropagation();
                onToggleMenu(openMenu === "links" ? null : "links");
              }}
            >
              <GlobeIcon />
              <span className="pane-artifacts-count">{links.length}</span>
            </button>
          </div>
        ) : null}
        <ArtifactContextMenu
          menu={ctxMenu}
          onClose={() => setCtxMenu(null)}
          onOpen={openExternal}
        />
      </div>
      {dropdown ? createPortal(dropdown, document.body) : null}
    </>
  );
}
