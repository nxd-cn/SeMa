export type TabDropAction =
  | { kind: "merge"; targetId: string }
  | { kind: "insert"; insertBeforeIndex: number }
  | { kind: "none" };

/** Top/bottom quarter → insert; middle half → merge (when over another tab). */
export function resolveTabDropFromTarget(
  sourceId: string,
  targetId: string,
  relativeY: number,
  tabHeight: number,
  targetIndex: number
): TabDropAction {
  if (sourceId === targetId) return { kind: "none" };
  if (tabHeight <= 0) return { kind: "none" };
  const zone = relativeY / tabHeight;
  if (zone < 0.25) {
    return { kind: "insert", insertBeforeIndex: targetIndex };
  }
  if (zone > 0.75) {
    return { kind: "insert", insertBeforeIndex: targetIndex + 1 };
  }
  return { kind: "merge", targetId };
}

export function reorderGroupList<T extends { id: string }>(
  groups: T[],
  sourceId: string,
  insertBeforeIndex: number
): T[] {
  const fromIndex = groups.findIndex((g) => g.id === sourceId);
  if (fromIndex === -1) return groups;
  let toIndex = Math.max(0, Math.min(insertBeforeIndex, groups.length));
  if (toIndex === fromIndex || toIndex === fromIndex + 1) return groups;
  const next = groups.slice();
  const [item] = next.splice(fromIndex, 1);
  if (fromIndex < toIndex) toIndex -= 1;
  next.splice(toIndex, 0, item);
  return next;
}
