// Generates the Orbit app icons — a dark rounded square with an accent diamond, matching the
// in-app "◆ Orbit" logo. Self-contained (only node:zlib/fs), so it runs the same on any OS:
//   resources/orbit.ico  (Windows, 256px PNG-in-ICO)
//   resources/orbit.png  (256px, generic)
//   resources/orbit.icns (macOS, 128/256/512/1024 PNG entries)
// Run once: `node scripts/gen-icon.mjs`. Re-run to regenerate after tweaking colours.
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SS = 4 // supersampling for smooth edges
const BG = [0x16, 0x18, 0x1d] // app background
const ACCENT = [0x7a, 0xa2, 0xf7] // app accent (tokyo-night blue)

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** Render a square RGBA PNG of the logo at the given pixel size. */
function renderPng(size) {
  const radius = Math.round((size * 46) / 256) // rounded-corner radius (scaled from the 256px design)
  const diamond = Math.round((size * 80) / 256) // half-diagonal of the diamond

  const sample = (x, y) => {
    const cx = clamp(x, radius, size - radius)
    const cy = clamp(y, radius, size - radius)
    const inRound = (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
    if (!inRound) return [0, 0, 0, 0]
    const inDiamond = Math.abs(x - size / 2) + Math.abs(y - size / 2) <= diamond
    return inDiamond ? [...ACCENT, 255] : [...BG, 255]
  }

  // Build the RGBA pixel buffer with supersampled anti-aliasing.
  const raw = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [sr, sg, sb, sa] = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)
          // premultiply so transparent edges blend cleanly
          r += sr * sa; g += sg * sa; b += sb * sa; a += sa
        }
      }
      const n = SS * SS
      const o = (y * size + x) * 4
      raw[o] = a ? Math.round(r / a) : 0
      raw[o + 1] = a ? Math.round(g / a) : 0
      raw[o + 2] = a ? Math.round(b / a) : 0
      raw[o + 3] = Math.round(a / n)
    }
  }
  return encodePng(size, raw)
}

// ---- encode PNG (8-bit RGBA) ----
function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (~c) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'latin1')
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}
function encodePng(size, raw) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6 // bit depth 8, colour type 6 (RGBA)
  // add filter byte (0) per scanline
  const rows = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0
    raw.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ---- wrap a 256px PNG in an ICO (PNG-compressed entry, Vista+) ----
function encodeIco(png) {
  const dir = Buffer.alloc(6)
  dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(1, 4)
  const entry = Buffer.alloc(16)
  entry[0] = 0; entry[1] = 0 // 0 => 256px
  entry[2] = 0; entry[3] = 0
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8); entry.writeUInt32LE(22, 12)
  return Buffer.concat([dir, entry, png])
}

// ---- pack PNG entries into an ICNS (macOS, PNG payloads supported since 10.7) ----
function encodeIcns(entries) {
  const body = Buffer.concat(
    entries.map(({ type, png }) => {
      const len = Buffer.alloc(4); len.writeUInt32BE(png.length + 8, 0)
      return Buffer.concat([Buffer.from(type, 'latin1'), len, png])
    })
  )
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'latin1')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(here, '..', 'resources')
fs.mkdirSync(outDir, { recursive: true })

const png256 = renderPng(256)
fs.writeFileSync(path.join(outDir, 'orbit.png'), png256)

const ico = encodeIco(png256)
fs.writeFileSync(path.join(outDir, 'orbit.ico'), ico)

// OSTypes carry the pixel size: ic07=128, ic08=256, ic09=512, ic10=1024.
const icns = encodeIcns([
  { type: 'ic07', png: renderPng(128) },
  { type: 'ic08', png: png256 },
  { type: 'ic09', png: renderPng(512) },
  { type: 'ic10', png: renderPng(1024) }
])
fs.writeFileSync(path.join(outDir, 'orbit.icns'), icns)

console.log(
  `wrote resources/orbit.ico (${ico.length} bytes), orbit.png (${png256.length} bytes), ` +
    `orbit.icns (${icns.length} bytes)`
)
