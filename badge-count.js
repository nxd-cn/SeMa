function clampBadgeCount(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.min(99, Math.floor(x));
}

function badgeDescription(n) {
  const c = clampBadgeCount(n);
  return c === 0 ? "" : `${c} 个未读`;
}

module.exports = { clampBadgeCount, badgeDescription };
