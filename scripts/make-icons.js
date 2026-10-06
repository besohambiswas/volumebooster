// Regenerates the PNG icons in icons/ using only Node's standard library.
// Usage: node scripts/make-icons.js
//
// The icon is drawn procedurally (rounded tile + speaker + sound waves),
// supersampled for smooth edges, and encoded as PNG by hand so the
// extension has zero build dependencies.
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const DESIGN = 128; // every shape coordinate lives in this space

// ---------------------------------------------------------------- PNG encoder

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      raw[o++] = rgba[i];
      raw[o++] = rgba[i + 1];
      raw[o++] = rgba[i + 2];
      raw[o++] = rgba[i + 3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// ---------------------------------------------------------------- shape math

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Rounded-square background (negative inside, positive outside).
function roundedRectDistance(u, v) {
  const half = DESIGN / 2;
  const radius = 30;
  const dx = Math.abs(u - half) - (half - radius);
  const dy = Math.abs(v - half) - (half - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

const CONE = [
  [47, 53],
  [64, 34],
  [64, 94],
  [47, 75]
];

function inSpeaker(u, v) {
  // cabinet
  if (u >= 30 && u <= 47 && v >= 53 && v <= 75) return true;
  // cone
  return pointInPolygon(u, v, CONE);
}

function inWaves(u, v) {
  const cx = 64, cy = 64;
  const dx = u - cx, dy = v - cy;
  const dist = Math.hypot(dx, dy);
  if (dist < 12 || dist > 34) return false;

  const angle = Math.abs(Math.atan2(dy, dx));
  if (angle > (50 * Math.PI) / 180) return false;

  const d1 = Math.abs(dist - 17);
  const d2 = Math.abs(dist - 30);
  return d1 <= 3.2 || d2 <= 3.2;
}

// One sample point in DESIGN space -> [r, g, b, a].
function sample(u, v) {
  if (roundedRectDistance(u, v) > 0.5) return [0, 0, 0, 0];

  // Diagonal gradient: bright blue (top-left) -> violet (bottom-right).
  const t = clamp01((u * 0.35 + v * 0.65) / DESIGN);
  let r = lerp(0x4f, 0x7b, t);
  let g = lerp(0x8c, 0x3f, t);
  let b = lerp(0xff, 0xf2, t);

  // Soft glassy highlight across the top of the tile.
  const gloss = Math.max(0, 1 - v / 54) * 0.22;
  r = lerp(r, 0xff, gloss);
  g = lerp(g, 0xff, gloss);
  b = lerp(b, 0xff, gloss);

  if (inSpeaker(u, v) || inWaves(u, v)) {
    r = 0xff;
    g = 0xff;
    b = 0xff;
  }

  return [r, g, b, 255];
}

// ---------------------------------------------------------------- rendering

function renderIcon(size) {
  const SS = 4; // supersampling factor for smooth edges
  const rgba = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) * (DESIGN / size);
          const v = (y + (sy + 0.5) / SS) * (DESIGN / size);
          const [sr, sg, sb, sa] = sample(u, v);
          r += sr * sa;
          g += sg * sa;
          b += sb * sa;
          a += sa;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      const alpha = a / n;
      if (alpha > 0) {
        rgba[i] = Math.round(r / a * 255);
        rgba[i + 1] = Math.round(g / a * 255);
        rgba[i + 2] = Math.round(b / a * 255);
        rgba[i + 3] = Math.round(alpha);
      }
    }
  }

  return encodePNG(size, rgba);
}

// ---------------------------------------------------------------- main

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, renderIcon(size));
  console.log(`wrote ${path.relative(path.join(__dirname, ".."), file)} (${size}x${size})`);
}
