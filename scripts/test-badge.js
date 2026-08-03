const assert = require("assert");
const { clampBadgeCount, badgeDescription } = require("../badge-count");

assert.strictEqual(clampBadgeCount(0), 0);
assert.strictEqual(clampBadgeCount(3), 3);
assert.strictEqual(clampBadgeCount(99), 99);
assert.strictEqual(clampBadgeCount(100), 99);
assert.strictEqual(clampBadgeCount(-1), 0);
assert.strictEqual(clampBadgeCount(1.9), 1);
assert.strictEqual(clampBadgeCount(NaN), 0);
assert.strictEqual(clampBadgeCount(undefined), 0);
assert.strictEqual(clampBadgeCount(null), 0);

assert.strictEqual(badgeDescription(0), "");
assert.strictEqual(badgeDescription(2), "2 个未读");
assert.strictEqual(badgeDescription(150), "99 个未读");

const { overlayPngForCount } = require("../badge-overlay");

const png1 = overlayPngForCount(1);
assert.ok(Buffer.isBuffer(png1), "PNG is Buffer");
assert.ok(png1.length > 50, "PNG has payload");
assert.strictEqual(png1[0], 0x89);
assert.strictEqual(png1.toString("ascii", 1, 4), "PNG");

const png1b = overlayPngForCount(1);
assert.strictEqual(png1b, png1, "cache hit for same count");

const png12 = overlayPngForCount(12);
assert.notStrictEqual(png12, png1, "different count → different image");
assert.ok(png12[0] === 0x89);

const png99 = overlayPngForCount(150);
const png99b = overlayPngForCount(99);
assert.strictEqual(png99, png99b, "clamp 150 → same cache as 99");

console.log("ok");
