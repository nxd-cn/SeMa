(() => {
  const tabsEl = document.getElementById("tabs");
  const columnsEl = document.getElementById("term-columns");
  const toolbarEl = document.getElementById("cli-toolbar");
  const toolbarToolsEl = document.getElementById("cli-toolbar-tools");
  const sidebarToggleBtn = document.getElementById("sidebar-toggle");
  const appEl = document.getElementById("app");
  const newBtn = document.getElementById("new-btn");
  const sidebar = document.getElementById("sidebar");
  const resizer = document.getElementById("sidebar-resizer");
  const modal = document.getElementById("cli-modal");
  const cliList = document.getElementById("cli-list");
  const cliCancel = document.getElementById("cli-cancel");

  const MIN_FLEX = 0.15;
  const ACTIVITY_CLIS = new Set([
    "claude",
    "cursor",
    "opencode",
    "pi",
    "codex",
    "gemini",
  ]);
  const IDLE_MS = 2500;
  const TOAST_MS = 10000;

  const toastsEl = document.getElementById("toasts");
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const idleTimers = new Map();
  /** @type {Map<string, { el: HTMLElement, timer: ReturnType<typeof setTimeout> }>} */
  const toasts = new Map();

  /** @type {Map<string, { term: any, fit: any, ime?: { detach: () => void }, host?: HTMLElement, resizeObserver?: ResizeObserver, pane: HTMLElement, body: HTMLElement, cwd: string, cliId: string, groupId: string, flex: number, detachBtn?: HTMLButtonElement, continueBtn?: HTMLButtonElement|null, activityArmed?: boolean }>} */
  const views = new Map();
  const termCtxEl = document.getElementById("term-ctx");
  let termCtxPaneId = null;

  function hideTermCtx() {
    if (!termCtxEl) return;
    termCtxEl.classList.add("hidden");
    termCtxEl.hidden = true;
    termCtxPaneId = null;
  }

  function showTermCtx(clientX, clientY, paneId, hasSelection) {
    if (!termCtxEl) return;
    termCtxPaneId = paneId;
    for (const action of ["copy", "delete"]) {
      const btn = termCtxEl.querySelector(`[data-action="${action}"]`);
      if (btn) btn.disabled = !hasSelection;
    }
    termCtxEl.classList.remove("hidden");
    termCtxEl.hidden = false;
    const pad = 4;
    const w = termCtxEl.offsetWidth || 120;
    const h = termCtxEl.offsetHeight || 90;
    const left = Math.min(clientX, window.innerWidth - w - pad);
    const top = Math.min(clientY, window.innerHeight - h - pad);
    termCtxEl.style.left = `${Math.max(pad, left)}px`;
    termCtxEl.style.top = `${Math.max(pad, top)}px`;
  }

  function deleteTermSelection(id, term) {
    const payload = window.tui.selectionDeletePayload(term.getSelection());
    term.clearSelection();
    if (payload) window.tui.write(id, payload);
  }

  if (termCtxEl) {
    termCtxEl.addEventListener("mousedown", (e) => e.stopPropagation());
    termCtxEl.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn || btn.disabled) return;
      const action = btn.getAttribute("data-action");
      const id = termCtxPaneId;
      const v = id && views.get(id);
      hideTermCtx();
      if (!v) return;
      if (action === "copy") {
        window.tui.clipboardWrite(v.term.getSelection());
      } else if (action === "paste") {
        const text = window.tui.clipboardRead();
        if (text) window.tui.write(id, text);
      } else if (action === "delete") {
        deleteTermSelection(id, v.term);
      } else if (action === "selectAll") {
        v.term.selectAll();
      }
    });
    document.addEventListener("mousedown", () => hideTermCtx());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideTermCtx();
    });
  }

  /** @type {Map<string, { li: HTMLElement, focusId: string }>} */
  const groups = new Map();
  let activeId = null;
  let groupSeq = 0;
  /** @type {{ cwd: string } | null} */
  let pendingFolder = null;
  /** @type {{ leftId: string, rightId: string, startX: number, leftFlex: number, rightFlex: number, leftW: number, rightW: number, el: HTMLElement } | null} */
  let colDrag = null;

  function folderName(cwd) {
    const norm = String(cwd || "").replace(/[\\/]+$/, "");
    const parts = norm.split(/[/\\]/);
    return parts[parts.length - 1] || "home";
  }

  function cliShort(cliId) {
    return cliId || "?";
  }

  function groupLabel(groupId) {
    const ids = groupSessionIds(groupId);
    if (!ids.length) return groupId;
    const seen = new Set();
    const names = [];
    for (const id of ids) {
      const name = cliShort(views.get(id).cliId);
      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
    const cwd = views.get(ids[0]).cwd;
    return `${names.join("&")} · ${folderName(cwd)}`;
  }

  function refreshGroupLabel(groupId) {
    const g = groups.get(groupId);
    if (!g) return;
    const ids = groupSessionIds(groupId);
    if (!ids.length) return;
    const text = groupLabel(groupId);
    g.li.textContent = text;
    g.li.title = `${text}\n${views.get(ids[0]).cwd}`;
    syncDetachButtons(groupId);
  }

  function syncDetachButtons(groupId) {
    const ids = groupSessionIds(groupId);
    const split = ids.length > 1;
    for (const id of ids) {
      const v = views.get(id);
      if (!v || !v.detachBtn) continue;
      v.detachBtn.hidden = !split;
    }
  }

  function hideContinue(id) {
    const v = views.get(id);
    if (!v || !v.continueBtn) return;
    v.continueBtn.remove();
    v.continueBtn = null;
  }

  function dismissToast(groupId) {
    const t = toasts.get(groupId);
    if (!t) return;
    clearTimeout(t.timer);
    t.el.remove();
    toasts.delete(groupId);
  }

  function unreadGroupCount() {
    let n = 0;
    for (const [, g] of groups) {
      if (g.li && g.li.classList.contains("unread")) n += 1;
    }
    return n;
  }

  function syncUnreadBadge() {
    if (!window.tui || typeof window.tui.setUnreadBadge !== "function") return;
    try {
      void window.tui.setUnreadBadge(unreadGroupCount());
    } catch (_) {}
  }

  function clearGroupActivity(groupId) {
    const timer = idleTimers.get(groupId);
    if (timer) clearTimeout(timer);
    idleTimers.delete(groupId);
    const g = groups.get(groupId);
    if (g) {
      g.li.classList.remove("busy");
      g.li.classList.remove("unread");
    }
    dismissToast(groupId);
    syncUnreadBadge();
  }

  function showIdleToast(groupId) {
    const g = groups.get(groupId);
    if (!g || !toastsEl) return;
    dismissToast(groupId);
    const el = document.createElement("button");
    el.type = "button";
    el.className = "toast";
    el.textContent = `${groupLabel(groupId)} · 本轮结束`;
    el.addEventListener("click", () => {
      dismissToast(groupId);
      const ids = groupSessionIds(groupId);
      if (!ids.length) return;
      const focus =
        g.focusId && ids.includes(g.focusId) ? g.focusId : ids[0];
      setActive(focus);
    });
    toastsEl.appendChild(el);
    const timer = setTimeout(() => dismissToast(groupId), TOAST_MS);
    toasts.set(groupId, { el, timer });
  }

  /** True when the user can see this group's output in the focused SeMa window. */
  function userLookingAtGroup(groupId) {
    const active = activeId && views.get(activeId);
    if (!active || active.groupId !== groupId) return false;
    // Another app focused: last active group is still "active", but user is elsewhere.
    if (typeof document.hasFocus === "function" && !document.hasFocus()) {
      return false;
    }
    return true;
  }

  function clearActiveGroupUnreadIfLooking() {
    const v = activeId && views.get(activeId);
    if (!v || !userLookingAtGroup(v.groupId)) return;
    const g = groups.get(v.groupId);
    if (!g || !g.li.classList.contains("unread")) return;
    g.li.classList.remove("unread");
    dismissToast(v.groupId);
    syncUnreadBadge();
  }

  function markGroupIdle(groupId) {
    idleTimers.delete(groupId);
    const g = groups.get(groupId);
    if (!g) return;
    if (!g.li.classList.contains("busy")) return;
    g.li.classList.remove("busy");
    // End of turn: require Enter again. Otherwise focus/prompt redraw
    // would keep re-triggering the pulse after the chat is already idle.
    for (const [, v] of views) {
      if (v.groupId === groupId) v.activityArmed = false;
    }
    if (userLookingAtGroup(groupId)) return;
    g.li.classList.add("unread");
    showIdleToast(groupId);
    syncUnreadBadge();
  }

  function noteActivity(sessionId, data) {
    const v = views.get(sessionId);
    if (!v || !v.activityArmed || !ACTIVITY_CLIS.has(v.cliId)) return;
    // Ignore tiny ANSI/cursor redraws from focus/resize.
    if (!looksLikeTurnOutput(data)) return;
    const g = groups.get(v.groupId);
    if (!g) return;
    g.li.classList.add("busy");
    const prev = idleTimers.get(v.groupId);
    if (prev) clearTimeout(prev);
    idleTimers.set(
      v.groupId,
      setTimeout(() => markGroupIdle(v.groupId), IDLE_MS)
    );
  }

  /** Strip CSI/OSC-ish sequences; require some real text or newlines. */
  function looksLikeTurnOutput(data) {
    const text = String(data || "")
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, "")
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
      .replace(/\x1b./g, "")
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
    if (text.indexOf("\r") !== -1 || text.indexOf("\n") !== -1) return true;
    return text.trim().length >= 3;
  }

  function armActivity(sessionId) {
    const v = views.get(sessionId);
    if (!v || !ACTIVITY_CLIS.has(v.cliId)) return;
    v.activityArmed = true;
  }

  function paneIsVisible(v) {
    return !!(v && v.pane && v.pane.classList.contains("visible"));
  }

  function pinTermBottom(term) {
    if (!term || typeof term.scrollToBottom !== "function") return;
    try {
      term.scrollToBottom();
    } catch (_) {}
  }

  function focusTerm(term) {
    if (!term || typeof term.focus !== "function") return;
    try {
      pinTermBottom(term);
      term.focus();
      try {
        const core = term._core;
        if (core && typeof core._syncTextArea === "function") {
          core._syncTextArea();
        }
      } catch (_) {}
      // xterm parks textarea at -9999em / 0×0 until sync; sync no-ops when
      // cursor is off-viewport — Windows IME then cannot attach.
      const recover = window.SeMaTermInputRecover;
      if (recover && typeof recover.ensureTextareaReadyForIme === "function") {
        recover.ensureTextareaReadyForIme(term.textarea);
      }
    } catch (_) {}
  }

  let settleGen = 0;

  function scheduleRecoverFocus(focusId) {
    const run = () => {
      if (activeId !== focusId) return;
      const v = views.get(focusId);
      if (!v) return;
      focusTerm(v.term);
    };
    run();
    setTimeout(run, 0);
    setTimeout(run, 50);
    setTimeout(run, 200);
    try {
      if (window.tui && typeof window.tui.focusWindow === "function") {
        window.tui.focusWindow();
      }
    } catch (_) {}
  }

  /** In-app confirm — never use window.confirm (steals OS focus; breaks IME). */
  function showConfirm(message) {
    return new Promise((resolve) => {
      const modal = document.getElementById("confirm-modal");
      const msgEl = document.getElementById("confirm-message");
      const okBtn = document.getElementById("confirm-ok");
      const cancelBtn = document.getElementById("confirm-cancel");
      if (!modal || !msgEl || !okBtn || !cancelBtn) {
        resolve(false);
        return;
      }
      msgEl.textContent = message || "确认？";
      modal.classList.remove("hidden");
      modal.setAttribute("aria-hidden", "false");
      const finish = (val) => {
        modal.classList.add("hidden");
        modal.setAttribute("aria-hidden", "true");
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        modal.removeEventListener("keydown", onKey);
        resolve(val);
      };
      const onOk = () => finish(true);
      const onCancel = () => finish(false);
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        } else if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        }
      };
      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
      modal.addEventListener("keydown", onKey);
      setTimeout(() => okBtn.focus(), 0);
    });
  }

  async function requestCloseGroup(groupId) {
    const g = groups.get(groupId);
    const label = (g && g.li && g.li.textContent) || "会话";
    const ok = await showConfirm(`关闭整组 ${label}?`);
    if (!ok) {
      if (activeId) scheduleRecoverFocus(activeId);
      return;
    }
    await closeGroup(groupId);
    if (activeId) scheduleRecoverFocus(activeId);
  }

  function fitPane(id) {
    const v = views.get(id);
    if (!v || !paneIsVisible(v)) return;
    const host =
      v.host || (v.term.element && v.term.element.parentElement) || null;
    const safe = window.SeMaTermFitSafe;
    const dims =
      v.term._core &&
      v.term._core._renderService &&
      v.term._core._renderService.dimensions;
    const cellW = dims && dims.css && dims.css.cell.width;
    const cellH = dims && dims.css && dims.css.cell.height;
    // Layout settle / hide↔show can briefly report 0×0. FitAddon mins are 2×1;
    // that reflows history and CLIs reprint banners one character per line.
    if (safe && typeof safe.canFitInHost === "function") {
      if (host && cellW > 0 && cellH > 0) {
        if (!safe.canFitInHost(host.clientWidth, host.clientHeight, cellW, cellH)) {
          return;
        }
      } else if (
        host &&
        (host.clientWidth < 160 || host.clientHeight < 80)
      ) {
        return;
      }
    }
    v.fit.fit();
    let cols = v.term.cols | 0;
    let rows = v.term.rows | 0;
    // FitAddon parseInt(getComputedStyle) can overshoot clientHeight (windowed
    // settle / h-scrollbar). Oversized rows shrink scroll-area; wheel can't
    // reach bottom until a later resize (e.g. fullscreen) re-fits.
    if (safe && host) {
      if (cellW > 0 && cellH > 0) {
        const proposed = safe.proposeFitDimensions(
          host.clientWidth,
          host.clientHeight,
          cellW,
          cellH,
          { scrollbarWidth: 0 }
        );
        if (proposed) {
          cols = proposed.cols;
          rows = safe.clampRowsToClientHeight(
            proposed.rows,
            cellH,
            host.clientHeight
          );
        } else {
          rows = safe.clampRowsToClientHeight(rows, cellH, host.clientHeight);
        }
        if (v.term.cols !== cols || v.term.rows !== rows) {
          v.term.resize(cols, rows);
        }
      }
    }
    try {
      const vp = v.term._core && v.term._core.viewport;
      if (vp && typeof vp.syncScrollArea === "function") vp.syncScrollArea(true);
    } catch (_) {}
    pinTermBottom(v.term);
    const minCols =
      safe && safe.MIN_FIT_COLS != null ? safe.MIN_FIT_COLS : 20;
    const minRows =
      safe && safe.MIN_FIT_ROWS != null ? safe.MIN_FIT_ROWS : 5;
    // Tiny sizes (many splits squeezed) can kill ConPTY / CLI processes and
    // permanently mangle scrollback via reflow.
    if (cols < minCols || rows < minRows) return;
    window.tui.resize(id, cols, rows);
  }

  function fitGroup(groupId) {
    for (const [sid, v] of views) {
      if (v.groupId === groupId) fitPane(sid);
    }
  }

  /** Fit + jump to bottom + focus after show/close layout (skip top→bottom crawl). */
  function settleGroupSoon(groupId, focusId) {
    const gen = ++settleGen;
    requestAnimationFrame(() => {
      if (gen !== settleGen) return;
      fitGroup(groupId);
      for (const [sid, v] of views) {
        if (v.groupId !== groupId || !paneIsVisible(v)) continue;
        pinTermBottom(v.term);
      }
      if (focusId && views.has(focusId)) focusTerm(views.get(focusId).term);
      requestAnimationFrame(() => {
        if (gen !== settleGen) return;
        for (const [sid, v] of views) {
          if (v.groupId !== groupId || !paneIsVisible(v)) continue;
          pinTermBottom(v.term);
        }
        if (focusId && views.has(focusId)) {
          focusTerm(views.get(focusId).term);
          scheduleRecoverFocus(focusId);
        }
      });
    });
  }

  function applyFlex(v) {
    v.pane.style.flex = `${v.flex} 1 0`;
  }

  /** @returns {string[]} */
  function groupSessionIds(groupId) {
    const ids = [];
    for (const el of columnsEl.children) {
      if (!el.classList || !el.classList.contains("term-pane")) continue;
      for (const [id, v] of views) {
        if (v.pane === el && v.groupId === groupId) {
          ids.push(id);
          break;
        }
      }
    }
    return ids;
  }

  /** Serialize prefs writes — closing a multi-pane group fires several saves; last wins. */
  let saveSplitTail = Promise.resolve();

  function saveSplit() {
    const run = async () => {
      try {
        if (!views.size) {
          // Clear layout + last so relaunch stays empty on both platforms.
          await window.tui.setPrefs({ layout: null, split: null, last: null });
          return;
        }
        const order = [...tabsEl.querySelectorAll("li[data-group-id]")].map(
          (li) => li.dataset.groupId
        );
        const saved = [];
        let activeGroupIndex = 0;
        for (const gid of order) {
          const ids = groupSessionIds(gid);
          if (!ids.length) continue;
          if (activeId && views.get(activeId).groupId === gid) {
            activeGroupIndex = saved.length;
          }
          const g = groups.get(gid);
          const focusId =
            activeId && views.get(activeId).groupId === gid
              ? activeId
              : g && g.focusId && ids.includes(g.focusId)
                ? g.focusId
                : ids[0];
          saved.push({
            panes: ids.map((id) => {
              const v = views.get(id);
              return { cwd: v.cwd, cliId: v.cliId, flex: v.flex };
            }),
            focus: Math.max(0, ids.indexOf(focusId)),
          });
        }
        if (!saved.length) {
          await window.tui.setPrefs({ layout: null, split: null, last: null });
          return;
        }
        await window.tui.setPrefs({
          layout: { groups: saved, activeGroupIndex },
          split: null,
        });
      } catch (_) {}
    };
    saveSplitTail = saveSplitTail.then(run, run);
    return saveSplitTail;
  }

  function clearResizers() {
    for (const el of [...columnsEl.querySelectorAll(".col-resizer")]) {
      el.remove();
    }
  }

  function rebuildResizers() {
    clearResizers();
    if (!activeId || !views.has(activeId)) return;
    const active = views.get(activeId);
    const ids = groupSessionIds(active.groupId);
    for (let i = 0; i < ids.length - 1; i++) {
      const left = views.get(ids[i]);
      const right = views.get(ids[i + 1]);
      const handle = document.createElement("div");
      handle.className = "col-resizer";
      handle.title = "拖动调整列宽";
      handle.addEventListener("mousedown", (e) => {
        e.preventDefault();
        colDrag = {
          leftId: ids[i],
          rightId: ids[i + 1],
          startX: e.clientX,
          leftFlex: left.flex,
          rightFlex: right.flex,
          leftW: left.pane.getBoundingClientRect().width,
          rightW: right.pane.getBoundingClientRect().width,
          el: handle,
        };
        handle.classList.add("dragging");
      });
      left.pane.after(handle);
    }
  }

  function ensureGroup(groupId, insertAfterLi) {
    if (groups.has(groupId)) return groups.get(groupId);
    const li = document.createElement("li");
    li.dataset.groupId = groupId;
    li.tabIndex = 0;
    li.draggable = true;
    li.addEventListener("click", () => {
      const g = groups.get(groupId);
      if (!g) return;
      const ids = groupSessionIds(groupId);
      if (!ids.length) return;
      const focus =
        g.focusId && ids.includes(g.focusId) ? g.focusId : ids[0];
      setActive(focus);
    });
    li.addEventListener("keydown", (e) => {
      if (e.key === "Delete") {
        e.preventDefault();
        requestCloseGroup(groupId);
      }
    });
    li.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      // Never window.confirm — native dialog steals OS focus and breaks IME.
      requestCloseGroup(groupId);
    });
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", groupId);
      e.dataTransfer.effectAllowed = "move";
      li.classList.add("dragging");
    });
    li.addEventListener("dragend", () => {
      li.classList.remove("dragging");
      for (const el of tabsEl.querySelectorAll(".drop-target")) {
        el.classList.remove("drop-target");
      }
    });
    li.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      li.classList.add("drop-target");
    });
    li.addEventListener("dragleave", () => {
      li.classList.remove("drop-target");
    });
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      li.classList.remove("drop-target");
      const src = e.dataTransfer.getData("text/plain");
      if (src) mergeGroups(src, groupId);
    });
    if (insertAfterLi && insertAfterLi.parentNode === tabsEl) {
      insertAfterLi.after(li);
    } else {
      tabsEl.appendChild(li);
    }
    const g = { li, focusId: "" };
    groups.set(groupId, g);
    return g;
  }

  function mergeGroups(sourceGroupId, targetGroupId) {
    if (!sourceGroupId || sourceGroupId === targetGroupId) return;
    if (!groups.has(sourceGroupId) || !groups.has(targetGroupId)) return;
    const target = groups.get(targetGroupId);
    const focusKeep = target.focusId;
    const sourceIds = groupSessionIds(sourceGroupId).slice();
    if (!sourceIds.length) return;
    const targetIds = groupSessionIds(targetGroupId);
    let insertAfter = targetIds.length
      ? views.get(targetIds[targetIds.length - 1]).pane
      : null;
    for (const id of sourceIds) {
      const v = views.get(id);
      if (!v) continue;
      v.groupId = targetGroupId;
      if (insertAfter) insertAfter.after(v.pane);
      else columnsEl.appendChild(v.pane);
      insertAfter = v.pane;
    }
    const src = groups.get(sourceGroupId);
    if (src) {
      clearGroupActivity(sourceGroupId);
      src.li.remove();
      groups.delete(sourceGroupId);
    }
    refreshGroupLabel(targetGroupId);
    const ids = groupSessionIds(targetGroupId);
    if (!ids.length) return;
    const focus =
      focusKeep && ids.includes(focusKeep) ? focusKeep : ids[0];
    setActive(focus);
  }

  function removeGroupIfEmpty(groupId) {
    if (groupSessionIds(groupId).length) {
      refreshGroupLabel(groupId);
      return;
    }
    clearGroupActivity(groupId);
    const g = groups.get(groupId);
    if (g) {
      g.li.remove();
      groups.delete(groupId);
    }
  }

  function setActive(id, opts) {
    if (!views.has(id)) return;
    const skipSave = !!(opts && opts.skipSave);
    activeId = id;
    const active = views.get(id);
    const g = groups.get(active.groupId);
    if (g) {
      g.focusId = id;
      g.li.classList.remove("unread");
    }
    dismissToast(active.groupId);
    for (const [sid, v] of views) {
      v.pane.classList.toggle("visible", v.groupId === active.groupId);
    }
    for (const [gid, grp] of groups) {
      grp.li.classList.toggle("active", gid === active.groupId);
    }
    rebuildResizers();
    settleGroupSoon(active.groupId, id);
    syncToolbarEnabled();
    syncUnreadBadge();
    if (!skipSave) saveSplit();
  }

  function removeView(id) {
    const v = views.get(id);
    if (!v) return;
    const { groupId } = v;
    const handoff = window.SeMaTermFocusHandoff;
    const sameGroup = groupSessionIds(groupId);
    const allIds = [...views.keys()];
    const survivorId =
      handoff && typeof handoff.pickSurvivorFocusId === "function"
        ? handoff.pickSurvivorFocusId(id, activeId, sameGroup, allIds)
        : activeId && activeId !== id
          ? activeId
          : sameGroup.filter((sid) => sid !== id)[0] ||
            allIds.filter((sid) => sid !== id)[0] ||
            null;

    // Focus survivor WHILE dying term still exists — after dispose Chromium
    // often leaves body focused and Chinese IME never reattaches.
    if (survivorId && views.has(survivorId)) {
      const surv = views.get(survivorId);
      activeId = survivorId;
      const g = groups.get(surv.groupId);
      if (g) {
        g.focusId = survivorId;
        g.li.classList.remove("unread");
      }
      dismissToast(surv.groupId);
      for (const [sid, view] of views) {
        if (sid === id) continue;
        view.pane.classList.toggle("visible", view.groupId === surv.groupId);
      }
      for (const [gid, grp] of groups) {
        grp.li.classList.toggle("active", gid === surv.groupId);
      }
      focusTerm(surv.term);
    } else {
      activeId = null;
    }

    const recover = window.SeMaTermInputRecover;
    if (recover && typeof recover.blurTermForDispose === "function") {
      recover.blurTermForDispose(v.term);
    }
    if (v.resizeObserver) {
      try {
        v.resizeObserver.disconnect();
      } catch (_) {}
    }
    if (v.ime && typeof v.ime.detach === "function") v.ime.detach();
    try {
      v.term.dispose();
    } catch (_) {}
    v.pane.remove();
    views.delete(id);
    clearResizers();
    const stillActiveCli = groupSessionIds(groupId).some((sid) => {
      const sv = views.get(sid);
      return sv && ACTIVITY_CLIS.has(sv.cliId);
    });
    if (!stillActiveCli) clearGroupActivity(groupId);
    removeGroupIfEmpty(groupId);

    if (survivorId && views.has(survivorId)) {
      rebuildResizers();
      settleGroupSoon(views.get(survivorId).groupId, survivorId);
      scheduleRecoverFocus(survivorId);
      syncToolbarEnabled();
      saveSplit();
    } else {
      syncToolbarEnabled();
      saveSplit();
    }
    syncUnreadBadge();
  }

  async function closeSession(id) {
    if (!views.has(id)) return;
    // Remove UI + hand off focus in the click turn BEFORE await — awaiting
    // killSession first drops user-activation and focus restore fails on Windows.
    removeView(id);
    try {
      await window.tui.killSession(id);
    } catch (_) {
      /* UI already closed; PTY may already be gone */
    }
  }

  async function closeGroup(groupId) {
    clearGroupActivity(groupId);
    const ids = groupSessionIds(groupId).slice();
    for (const id of ids) {
      removeView(id);
      try {
        await window.tui.killSession(id);
      } catch (_) {
        /* UI already closed */
      }
    }
    // Final persist after the whole group is gone (avoids racing mid-close saves).
    await saveSplit();
    syncUnreadBadge();
  }

  function detachSession(id) {
    const v = views.get(id);
    if (!v) return;
    const oldGroupId = v.groupId;
    if (groupSessionIds(oldGroupId).length <= 1) return;
    const oldG = groups.get(oldGroupId);
    const newGroupId = `g-${++groupSeq}`;
    v.groupId = newGroupId;
    v.flex = 1;
    applyFlex(v);
    ensureGroup(newGroupId, oldG && oldG.li);
    refreshGroupLabel(oldGroupId);
    refreshGroupLabel(newGroupId);
    setActive(id);
  }

  /**
   * @returns {Promise<string|null>}
   */
  async function openSession(cwd, cliId, opts) {
    const silent = !!(opts && opts.silent);
    const skipSave = !!(opts && opts.skipSave);
    const groupId = (opts && opts.groupId) || `g-${++groupSeq}`;
    const flex =
      opts && typeof opts.flex === "number" && opts.flex > 0 ? opts.flex : 1;
    let result;
    try {
      result = await window.tui.createSession({ cwd, cliId });
    } catch (err) {
      if (!silent) alert(err && err.message ? err.message : String(err));
      return null;
    }
    const { id, canResume } = result;

    ensureGroup(groupId);

    const pane = document.createElement("div");
    pane.className = "term-pane";

    const chrome = document.createElement("div");
    chrome.className = "pane-chrome";
    const cwdEl = document.createElement("span");
    cwdEl.className = "pane-cwd";
    cwdEl.textContent = cwd;
    cwdEl.title = cwd;
    const actions = document.createElement("div");
    actions.className = "pane-actions";
    let continueBtn = null;
    if (canResume) {
      continueBtn = document.createElement("button");
      continueBtn.type = "button";
      continueBtn.className = "pane-continue";
      continueBtn.title = "继续上次会话";
      continueBtn.textContent = "↻";
      continueBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        hideContinue(id);
        const v = views.get(id);
        if (!v) return;
        try {
          v.term.reset();
          await window.tui.respawnSession({ id, cwd, cliId, resume: true });
        } catch (_) {
          try {
            v.term.reset();
            await window.tui.respawnSession({ id, cwd, cliId, resume: false });
          } catch (err) {
            alert(err && err.message ? err.message : String(err));
          }
        }
        requestAnimationFrame(() => fitPane(id));
      });
      actions.appendChild(continueBtn);
    }
    const detachBtn = document.createElement("button");
    detachBtn.type = "button";
    detachBtn.className = "pane-detach";
    detachBtn.title = "独立为新会话";
    detachBtn.textContent = "⤢";
    detachBtn.hidden = true;
    detachBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      detachSession(id);
    });
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "pane-close";
    closeBtn.title = "关闭此栏";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("mousedown", (e) => {
      const handoff = window.SeMaTermFocusHandoff;
      if (handoff && typeof handoff.closeButtonMouseDownAction === "function") {
        handoff.closeButtonMouseDownAction(e);
      } else {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeSession(id);
    });
    actions.appendChild(detachBtn);
    actions.appendChild(closeBtn);
    chrome.appendChild(cwdEl);
    chrome.appendChild(actions);

    const body = document.createElement("div");
    body.className = "pane-body";
    const host = document.createElement("div");
    host.className = "pane-term-host";
    body.appendChild(host);
    pane.appendChild(chrome);
    pane.appendChild(body);
    columnsEl.appendChild(pane);

    pane.addEventListener("mousedown", () => {
      if (activeId !== id) setActive(id);
      else term.focus();
    });

    const term = new window.Terminal({
      cursorBlink: true,
      fontFamily:
        'Menlo, Monaco, Cascadia Mono, Consolas, "Courier New", monospace',
      fontSize: 13,
      theme: {
        background: "#0c0c0c",
        foreground: "#cccccc",
        selectionBackground: "#264f78",
        selectionInactiveBackground: "#264f78",
      },
    });
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(host);
    term.focus();
    let fitRoRaf = 0;
    /** @type {ResizeObserver | undefined} */
    let resizeObserver;
    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(() => {
        if (fitRoRaf) cancelAnimationFrame(fitRoRaf);
        fitRoRaf = requestAnimationFrame(() => {
          fitRoRaf = 0;
          const cur = views.get(id);
          // Hidden panes may still resize in absolute park — never fit those
          // (tiny/wrong geometry can kill ConPTY / detach IME).
          if (!cur || !paneIsVisible(cur)) return;
          fitPane(id);
          pinTermBottom(cur.term);
          if (activeId === id) focusTerm(cur.term);
        });
      });
      resizeObserver.observe(host);
    }
    // Ink AI CLIs park hardware cursor at row end; pin IME to inverse caret.
    const ime =
      window.SeMaImeAnchor && typeof window.SeMaImeAnchor.attachImeHeuristic === "function"
        ? window.SeMaImeAnchor.attachImeHeuristic(term)
        : { detach() {} };
    if (term.textarea) {
      term.textarea.setAttribute("lang", "zh-CN");
      term.textarea.addEventListener("focus", () => {
        if (activeId !== id) setActive(id);
      });
    }
    // Only hide continue / arm activity after the user starts a chat (Enter).
    term.onData((data) => {
      if (data === "\r" || data === "\n" || data.indexOf("\r") !== -1) {
        hideContinue(id);
        armActivity(id);
      }
      window.tui.write(id, data);
    });

    term.attachCustomKeyEventHandler((ev) => {
      // CapsLock must not reach CompositionHelper during CJK IME (macOS
      // Chinese→English toggle); otherwise xterm 5.5 double-sends preedit.
      if (
        window.tui.shouldSuppressForImeComposition &&
        window.tui.shouldSuppressForImeComposition({
          type: ev.type,
          key: ev.key,
          keyCode: ev.keyCode,
          which: ev.which,
        })
      ) {
        return false;
      }

      const delSel = window.tui.selectionDeleteAction(
        {
          type: ev.type,
          key: ev.key,
          ctrlKey: ev.ctrlKey,
          metaKey: ev.metaKey,
          altKey: ev.altKey,
        },
        term.hasSelection()
      );
      if (delSel === "deleteSelection") {
        ev.preventDefault();
        ev.stopPropagation();
        deleteTermSelection(id, term);
        return false;
      }

      if (
        window.tui.lineClearAction({
          type: ev.type,
          key: ev.key,
          ctrlKey: ev.ctrlKey,
          metaKey: ev.metaKey,
          altKey: ev.altKey,
          shiftKey: ev.shiftKey,
        }) === "clearLine"
      ) {
        ev.preventDefault();
        ev.stopPropagation();
        term.clearSelection();
        window.tui.write(id, window.tui.LINE_CLEAR_PAYLOAD);
        return false;
      }

      // Windows only: Ctrl+Z → readline undo (\\x1f). Never pass \\x1a (EOF).
      if (
        window.tui.undoAction({
          type: ev.type,
          key: ev.key,
          code: ev.code,
          keyCode: ev.keyCode,
          which: ev.which,
          ctrlKey: ev.ctrlKey,
          metaKey: ev.metaKey,
          altKey: ev.altKey,
          shiftKey: ev.shiftKey,
        }) === "undo"
      ) {
        ev.preventDefault();
        ev.stopPropagation();
        window.tui.write(id, window.tui.UNDO_PAYLOAD);
        return false;
      }

      const action = window.tui.clipboardAction(
        {
          type: ev.type,
          key: ev.key,
          ctrlKey: ev.ctrlKey,
          metaKey: ev.metaKey,
          shiftKey: ev.shiftKey,
        },
        term.hasSelection()
      );
      if (action === "copy") {
        ev.preventDefault();
        ev.stopPropagation();
        window.tui.clipboardWrite(term.getSelection());
        return false;
      }
      if (action === "paste") {
        ev.preventDefault();
        ev.stopPropagation();
        const text = window.tui.clipboardRead();
        if (text) window.tui.write(id, text);
        return false;
      }
      return true;
    });

    body.addEventListener("mousedown", () => {
      if (activeId !== id) setActive(id);
      else term.focus();
    });

    body.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showTermCtx(e.clientX, e.clientY, id, term.hasSelection());
    });

    const view = {
      term,
      fit,
      ime,
      host,
      resizeObserver,
      pane,
      body,
      cwd,
      cliId,
      groupId,
      flex,
      detachBtn,
      continueBtn,
      activityArmed: false,
    };
    applyFlex(view);
    views.set(id, view);
    refreshGroupLabel(groupId);
    setActive(id, { skipSave });
    return id;
  }

  function targetForToolbarOpen() {
    if (activeId && views.has(activeId)) {
      const v = views.get(activeId);
      return { cwd: v.cwd, groupId: v.groupId };
    }
    const gids = [...tabsEl.querySelectorAll("li[data-group-id]")].map(
      (li) => li.dataset.groupId
    );
    if (!gids.length) return null;
    const gid = gids[gids.length - 1];
    const ids = groupSessionIds(gid);
    if (!ids.length) return null;
    const v = views.get(ids[ids.length - 1]);
    return v ? { cwd: v.cwd, groupId: v.groupId } : null;
  }

  let sidebarCollapsed = false;

  function applySidebarCollapsed(collapsed) {
    sidebarCollapsed = !!collapsed;
    appEl.classList.toggle("sidebar-collapsed", sidebarCollapsed);
    if (sidebarToggleBtn) {
      sidebarToggleBtn.textContent = sidebarCollapsed ? "☰" : "◀";
      const tip = sidebarCollapsed ? "显示侧栏" : "隐藏侧栏";
      sidebarToggleBtn.title = tip;
      sidebarToggleBtn.setAttribute("aria-label", tip);
      sidebarToggleBtn.setAttribute(
        "aria-expanded",
        sidebarCollapsed ? "false" : "true"
      );
    }
    if (activeId) {
      const v = views.get(activeId);
      if (v) settleGroupSoon(v.groupId, activeId);
    }
  }

  function syncToolbarEnabled() {
    const on = views.size > 0;
    const root = toolbarToolsEl || toolbarEl;
    for (const btn of root.querySelectorAll("button")) {
      btn.disabled = !on;
    }
  }

  async function refreshToolbar() {
    let tools;
    try {
      ({ tools } = await window.tui.listCli());
    } catch (_) {
      return;
    }
    const host = toolbarToolsEl || toolbarEl;
    host.innerHTML = "";
    for (const tool of tools) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = tool.label;
      btn.title = `分栏打开 ${tool.label}`;
      btn.addEventListener("click", async () => {
        const target = targetForToolbarOpen();
        if (!target) return;
        await openSession(target.cwd, tool.id, { groupId: target.groupId });
      });
      host.appendChild(btn);
    }
    syncToolbarEnabled();
  }

  function hideModal() {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    pendingFolder = null;
    cliList.innerHTML = "";
  }

  async function showCliModal(cwd) {
    pendingFolder = { cwd };
    let tools;
    try {
      ({ tools } = await window.tui.listCli());
    } catch (err) {
      alert(err && err.message ? err.message : String(err));
      return;
    }
    cliList.innerHTML = "";
    for (const tool of tools) {
      const li = document.createElement("li");
      li.textContent = tool.label;
      li.title = tool.path || tool.command;
      li.addEventListener("click", async () => {
        const folder = pendingFolder && pendingFolder.cwd;
        hideModal();
        if (folder) await openSession(folder, tool.id);
      });
      cliList.appendChild(li);
    }
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
  }

  newBtn.addEventListener("click", async () => {
    const picked = await window.tui.pickFolder();
    if (picked.canceled || !picked.path) return;
    await showCliModal(picked.path);
  });

  cliCancel.addEventListener("click", () => hideModal());

  window.addEventListener("mousemove", (e) => {
    if (!colDrag) return;
    const left = views.get(colDrag.leftId);
    const right = views.get(colDrag.rightId);
    if (!left || !right) return;
    const dx = e.clientX - colDrag.startX;
    const totalW = colDrag.leftW + colDrag.rightW;
    const totalFlex = colDrag.leftFlex + colDrag.rightFlex;
    if (totalW <= 0 || totalFlex <= 0) return;
    let newLeftW = colDrag.leftW + dx;
    newLeftW = Math.max(0, Math.min(totalW, newLeftW));
    let newLeftFlex = (newLeftW / totalW) * totalFlex;
    newLeftFlex = Math.max(
      MIN_FLEX,
      Math.min(totalFlex - MIN_FLEX, newLeftFlex)
    );
    left.flex = newLeftFlex;
    right.flex = totalFlex - newLeftFlex;
    applyFlex(left);
    applyFlex(right);
    fitPane(colDrag.leftId);
    fitPane(colDrag.rightId);
  });

  window.addEventListener("mouseup", async () => {
    if (colDrag) {
      colDrag.el.classList.remove("dragging");
      colDrag = null;
      await saveSplit();
    }
  });

  let sidebarDragging = false;
  resizer.addEventListener("mousedown", (e) => {
    if (sidebarCollapsed) return;
    sidebarDragging = true;
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!sidebarDragging || sidebarCollapsed) return;
    const w = Math.min(400, Math.max(100, e.clientX));
    sidebar.style.width = `${w}px`;
  });
  window.addEventListener("mouseup", async () => {
    if (!sidebarDragging) return;
    sidebarDragging = false;
    const width = parseInt(sidebar.style.width, 10) || 160;
    if (activeId) {
      const v = views.get(activeId);
      if (v) settleGroupSoon(v.groupId, activeId);
    }
    try {
      await window.tui.setPrefs({ sidebarWidth: width });
    } catch (_) {}
  });

  if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener("click", async () => {
      applySidebarCollapsed(!sidebarCollapsed);
      try {
        await window.tui.setPrefs({ sidebarCollapsed });
      } catch (_) {}
    });
  }

  window.tui.onData(({ id, data }) => {
    const v = views.get(id);
    if (!v) return;
    v.term.write(data);
    noteActivity(id, data);
  });

  window.tui.onExit(({ id }) => {
    removeView(id);
  });

  window.addEventListener("resize", () => {
    if (!activeId) return;
    const v = views.get(activeId);
    if (!v) return;
    settleGroupSoon(v.groupId, activeId);
  });

  // Returning to SeMa while still on an unread group counts as reading it.
  window.addEventListener("focus", () => {
    clearActiveGroupUnreadIfLooking();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      clearActiveGroupUnreadIfLooking();
    }
  });

  async function restoreSplit(prefs, tools) {
    const toolIds = new Set(tools.map((t) => t.id));
    let groupsSpec = null;
    let activeGroupIndex = 0;

    if (
      prefs.layout &&
      Array.isArray(prefs.layout.groups) &&
      prefs.layout.groups.length
    ) {
      groupsSpec = prefs.layout.groups;
      activeGroupIndex =
        typeof prefs.layout.activeGroupIndex === "number"
          ? prefs.layout.activeGroupIndex
          : 0;
    } else if (
      prefs.split &&
      prefs.split.cwd &&
      Array.isArray(prefs.split.panes) &&
      prefs.split.panes.length
    ) {
      // migrate old single-group split
      groupsSpec = [
        {
          panes: prefs.split.panes.map((p) => ({
            cwd: prefs.split.cwd,
            cliId: p.cliId,
            flex: p.flex,
          })),
          focus: prefs.split.focus || 0,
        },
      ];
    }

    if (!groupsSpec || !groupsSpec.length) return false;

    /** @type {string|null} */
    let focusSessionId = null;
    let any = false;

    for (let gi = 0; gi < groupsSpec.length; gi++) {
      const gspec = groupsSpec[gi];
      if (!gspec || !Array.isArray(gspec.panes) || !gspec.panes.length) continue;
      const panes = gspec.panes.filter(
        (p) => p && p.cwd && toolIds.has(p.cliId)
      );
      if (!panes.length) continue;

      const groupId = `g-${++groupSeq}`;
      const focusIndex =
        typeof gspec.focus === "number" && gspec.focus >= 0 ? gspec.focus : 0;
      /** @type {string[]} */
      const opened = [];
      for (let i = 0; i < panes.length; i++) {
        const p = panes[i];
        const flex = typeof p.flex === "number" && p.flex > 0 ? p.flex : 1;
        const id = await openSession(p.cwd, p.cliId, {
          silent: true,
          groupId,
          flex,
          skipSave: true,
        });
        if (!id) continue;
        opened.push(id);
        any = true;
      }
      if (!opened.length) continue;
      const localFocus = opened[Math.min(focusIndex, opened.length - 1)];
      const g = groups.get(groupId);
      if (g) g.focusId = localFocus;
      if (gi === activeGroupIndex || focusSessionId === null) {
        focusSessionId = localFocus;
      }
    }

    if (!any || !focusSessionId) return false;
    setActive(focusSessionId);
    await saveSplit();
    return true;
  }

  async function boot() {
    const prefs = await window.tui.getPrefs();
    if (prefs.sidebarWidth) sidebar.style.width = `${prefs.sidebarWidth}px`;
    applySidebarCollapsed(!!prefs.sidebarCollapsed);
    await refreshToolbar();
    const { tools } = await window.tui.listCli();
    const restored = await restoreSplit(prefs, tools);
    syncUnreadBadge();
    if (restored) return;

    // No layout (user closed all, or first launch): stay empty on both platforms.
  }

  boot();
})();
