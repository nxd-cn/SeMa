const zlib = require("zlib");
const { clampBadgeCount } = require("./badge-count");

const SIZE = 32;
const cache = new Map();

/** 3×5 digit bitmaps, MSB left; rows top→bottom. */
const DIGITS = {
  0: [0b111, 0b101, 0b101, 0b101, 0b111],
  1: [0b010, 0b110, 0b010, 0b010, 0b111],
  2: [0b111, 0b001, 0b111, 0b100, 0b111],
  3: [0b111, 0b001, 0b111, 0b001, 0b111],
  4: [0b101, 0b101, 0b111, 0b001, 0b001],
  5: [0b111, 0b100, 0b111, 0b001, 0b111],
  6: [0b111, 0b100, 0b111, 0b101, 0b111],
  7: [0b111, 0b001, 0b001, 0b001, 0b001],
  8: [0b111, 0b101, 0b111, 0b101, 0b111],
  9: [0b111, 0b101, 0b111, 0b001, 0b111],
};

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function drawDigit(rgba, digit, ox, oy, scale, color) {
  const rows = DIGITS[digit];
  if (!rows) return;
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if ((rows[y] >> (2 - x)) & 1) {
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const px = ox + x * scale + dx;
            const py = oy + y * scale + dy;
            if (px < 0 || py < 0 || px >= SIZE || py >= SIZE) continue;
            const i = (py * SIZE + px) * 4;
            rgba[i] = color[0];
            rgba[i + 1] = color[1];
            rgba[i + 2] = color[2];
            rgba[i + 3] = color[3];
          }
        }
      }
    }
  }
}

function buildRgba(count) {
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  const cx = (SIZE - 1) / 2;
  const cy = (SIZE - 1) / 2;
  const r = 15;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) {
        const i = (y * SIZE + x) * 4;
        rgba[i] = 0xe0;
        rgba[i + 1] = 0x3e;
        rgba[i + 2] = 0x3e;
        rgba[i + 3] = 255;
      }
    }
  }
  const text = String(count);
  const scale = count >= 10 ? 2 : 3;
  const glyphW = 3 * scale;
  const glyphH = 5 * scale;
  const gap = scale;
  const totalW =
    text.length * glyphW + (text.length - 1) * gap;
  let ox = Math.floor((SIZE - totalW) / 2);
  const oy = Math.floor((SIZE - glyphH) / 2);
  for (const ch of text) {
    drawDigit(rgba, Number(ch), ox, oy, scale, [255, 255, 255, 255]);
    ox += glyphW + gap;
  }
  return rgba;
}

function encodePng(rgba) {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function overlayPngForCount(n) {
  const c = clampBadgeCount(n);
  if (c === 0) {
    return Buffer.alloc(0);
  }
  let buf = cache.get(c);
  if (!buf) {
    buf = encodePng(buildRgba(c));
    cache.set(c, buf);
  }
  return buf;
}

module.exports = { overlayPngForCount };
