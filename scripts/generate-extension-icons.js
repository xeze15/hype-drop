#!/usr/bin/env node
'use strict';

// Generates the extension's PNG icons (a small pokéball-ish mark) without any
// image libraries — writes raw RGBA and deflates it into a valid PNG.
//   node scripts/generate-extension-icons.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function pngFromRGBA(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // rows with filter byte 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// Draw a pokéball: red top, white bottom, black band + center button.
function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const R = size * 0.46; // ball radius
  const band = Math.max(1.2, size * 0.09);
  const btnR = size * 0.16;
  const btnRing = size * 0.05;
  const set = (x, y, r, g, b, a) => {
    const i = (y * size + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > R + 0.5) {
        set(x, y, 0, 0, 0, 0); // transparent outside
        continue;
      }
      const edge = dist > R - 1 ? 1 : 0; // outline
      const centerDist = Math.sqrt(dx * dx + dy * dy);
      if (centerDist <= btnR) {
        // center button: white with black ring
        if (centerDist >= btnR - btnRing) set(x, y, 20, 24, 34, 255);
        else set(x, y, 240, 244, 250, 255);
      } else if (Math.abs(dy) <= band / 2) {
        set(x, y, 20, 24, 34, 255); // black band
      } else if (edge) {
        set(x, y, 20, 24, 34, 255); // outline
      } else if (dy < 0) {
        set(x, y, 239, 68, 68, 255); // red top
      } else {
        set(x, y, 244, 246, 250, 255); // white bottom
      }
    }
  }
  return rgba;
}

const outDir = path.join(__dirname, '..', 'extension', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  const png = pngFromRGBA(size, size, drawIcon(size));
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png);
  console.log('wrote', `extension/icons/icon${size}.png`, `(${png.length} bytes)`);
}
