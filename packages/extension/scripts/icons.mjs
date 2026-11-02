// Writes public/icon/{16,32,48,128}.png: a red rounded square with a white rectangle mark,
// drawn without dependencies (node scripts/icons.mjs).
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const RED = [225, 29, 72]
const WHITE = [255, 255, 255]

function pixel(size, x, y) {
  const u = (x + 0.5) / size
  const v = (y + 0.5) / size
  const r = 0.2
  // the rounded square
  const dx = Math.max(r - u, 0, u - (1 - r))
  const dy = Math.max(r - v, 0, v - (1 - r))
  if (dx * dx + dy * dy > r * r) return [0, 0, 0, 0]
  // a rectangle outline, the mark
  const w = Math.max(0.09, 1.6 / size)
  const inOuter = u > 0.22 && u < 0.78 && v > 0.28 && v < 0.72
  const inInner = u > 0.22 + w && u < 0.78 - w && v > 0.28 + w && v < 0.72 - w
  return [...(inOuter && !inInner ? WHITE : RED), 255]
}

function crc32(bytes) {
  let c = ~0
  for (const b of bytes) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) Buffer.from(pixel(size, x, y)).copy(raw, y * (size * 4 + 1) + 1 + x * 4)
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

mkdirSync(new URL('../public/icon/', import.meta.url), { recursive: true })
for (const size of [16, 32, 48, 128]) writeFileSync(new URL(`../public/icon/${size}.png`, import.meta.url), png(size))
