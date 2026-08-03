/**
 * Focus handoff when closing a terminal pane.
 * Always pick/focus the survivor BEFORE disposing the dying term — otherwise
 * Chromium leaves body focused and Chinese IME cannot attach.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SeMaTermFocusHandoff = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  /**
   * @param {string} closingId
   * @param {string|null} activeId
   * @param {string[]} sameGroupIds including closingId
   * @param {string[]} allIds
   * @returns {string|null}
   */
  function pickSurvivorFocusId(closingId, activeId, sameGroupIds, allIds) {
    const group = (sameGroupIds || []).filter((id) => id && id !== closingId);
    const all = (allIds || []).filter((id) => id && id !== closingId);
    if (activeId && activeId !== closingId) {
      return all.includes(activeId) ? activeId : all[0] || null;
    }
    if (group.length) return group[0];
    return all[0] || null;
  }

  /**
   * Close-button mousedown must not steal focus from the terminal.
   * @param {{ preventDefault?: Function, stopPropagation?: Function }} ev
   * @returns {"prevent"}
   */
  function closeButtonMouseDownAction(ev) {
    if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
    if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
    return "prevent";
  }

  return { pickSurvivorFocusId, closeButtonMouseDownAction };
});
