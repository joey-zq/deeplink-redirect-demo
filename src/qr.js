/**
 * Byte-mode QR encoder, versions 1–20, error correction L or M.
 *
 * Here so the demo can show a scannable code without calling any external
 * service — the whole point of the page is that it depends on nothing.
 *
 * The version tables in qr-tables.js are generated from segno, and every
 * matrix this produces is compared module-for-module against segno in
 * test.mjs. It is not a from-memory reimplementation of the spec.
 */
import { EC, ALIGN } from './qr-tables.js'

const MAX_VERSION = 20

// ------------------------------------------------------------- GF(256)

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d // the QR primitive polynomial
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
}

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a] + LOG[b]]
}

/** Reed–Solomon generator polynomial of the given degree. */
function rsGenerator(degree) {
  let poly = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0)
    // coefficients are held highest-degree first, so multiplying by
    // (x + a) shifts poly[j] into next[j] and its a-term into next[j + 1]
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], EXP[i])
    }
    poly = next
  }
  return poly
}

function rsRemainder(data, degree) {
  const gen = rsGenerator(degree)
  const rem = new Array(degree).fill(0)
  for (const byte of data) {
    const factor = byte ^ rem[0]
    rem.shift()
    rem.push(0)
    for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i + 1], factor)
  }
  return rem
}

// ------------------------------------------------------------- encoding

function charCountBits(version) {
  return version <= 9 ? 8 : 16
}

function dataCodewords(version, level) {
  return EC[level][version].reduce((n, [blocks, , data]) => n + blocks * data, 0)
}

function totalCodewords(version, level) {
  return EC[level][version].reduce((n, [blocks, total]) => n + blocks * total, 0)
}

function pickVersion(byteLength, level) {
  for (let v = 1; v <= MAX_VERSION; v++) {
    const capacity = dataCodewords(v, level) * 8
    if (4 + charCountBits(v) + byteLength * 8 <= capacity) return v
  }
  throw new Error('content too long for a version ' + MAX_VERSION + ' QR code')
}

function toCodewords(bytes, version, level) {
  const bits = []
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }

  push(0b0100, 4) // byte mode
  push(bytes.length, charCountBits(version))
  for (const b of bytes) push(b, 8)

  const capacity = dataCodewords(version, level) * 8
  push(0, Math.min(4, capacity - bits.length)) // terminator
  while (bits.length % 8 !== 0) bits.push(0)

  const words = []
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]
    words.push(byte)
  }
  for (let pad = 0xec; words.length < dataCodewords(version, level); pad ^= 0xec ^ 0x11) {
    words.push(pad)
  }
  return words
}

/** Split into blocks, add error correction, interleave. */
function interleave(words, version, level) {
  const blocks = []
  let offset = 0
  let maxData = 0
  let ecLength = 0

  for (const [count, total, data] of EC[level][version]) {
    for (let i = 0; i < count; i++) {
      const chunk = words.slice(offset, offset + data)
      offset += data
      blocks.push({ data: chunk, ec: rsRemainder(chunk, total - data) })
      maxData = Math.max(maxData, data)
      ecLength = total - data
    }
  }

  const out = []
  for (let i = 0; i < maxData; i++) {
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i])
  }
  for (let i = 0; i < ecLength; i++) {
    for (const block of blocks) out.push(block.ec[i])
  }
  return out
}

// ------------------------------------------------------------- matrix


function newMatrix(size) {
  return Array.from({ length: size }, () => new Array(size).fill(null))
}

function placeFinder(m, reserved, row, col) {
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const r = row + dr
      const c = col + dc
      if (r < 0 || c < 0 || r >= m.length || c >= m.length) continue
      const inner = Math.max(Math.abs(dr - 3), Math.abs(dc - 3))
      m[r][c] = inner !== 2 && inner <= 3 ? 1 : 0
      reserved[r][c] = true
    }
  }
}

function buildFunctionPatterns(version) {
  const size = version * 4 + 17
  const m = newMatrix(size)
  const reserved = newMatrix(size).map((row) => row.map(() => false))

  placeFinder(m, reserved, 0, 0)
  placeFinder(m, reserved, 0, size - 7)
  placeFinder(m, reserved, size - 7, 0)

  // timing patterns
  for (let i = 8; i < size - 8; i++) {
    m[6][i] = m[i][6] = i % 2 === 0 ? 1 : 0
    reserved[6][i] = reserved[i][6] = true
  }

  // alignment patterns, skipping the three finder corners
  const centres = ALIGN[version]
  for (const r of centres) {
    for (const c of centres) {
      const corner =
        (r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)
      if (corner) continue
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          m[r + dr][c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1 ? 1 : 0
          reserved[r + dr][c + dc] = true
        }
      }
    }
  }

  // format information areas, and the module that is always dark
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) { m[8][i] = 0; reserved[8][i] = true }
    if (!reserved[i][8]) { m[i][8] = 0; reserved[i][8] = true }
  }
  for (let i = 0; i < 8; i++) {
    m[8][size - 1 - i] = 0
    reserved[8][size - 1 - i] = true
    m[size - 1 - i][8] = 0
    reserved[size - 1 - i][8] = true
  }
  m[size - 8][8] = 1
  reserved[size - 8][8] = true

  // version information, version 7 and up
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3)
      const c = size - 11 + (i % 3)
      m[r][c] = 0
      reserved[r][c] = true
      m[c][r] = 0
      reserved[c][r] = true
    }
  }

  return { m, reserved, size }
}

function placeData(m, reserved, size, codewords) {
  let bit = 0
  const total = codewords.length * 8

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5 // the vertical timing pattern column is skipped
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j
        const upward = ((right + 1) & 2) === 0
        const row = upward ? size - 1 - vert : vert
        if (reserved[row][col]) continue
        m[row][col] = bit < total ? (codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1 : 0
        bit++
      }
    }
  }
}

function maskBit(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0
    case 1: return r % 2 === 0
    case 2: return c % 3 === 0
    case 3: return (r + c) % 3 === 0
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
  }
}

const FINDER_RUN = [1, 1, 3, 1, 1]

function penalty(m, size) {
  let score = 0

  // rule 1: runs of five or more, and rule 3: finder-like patterns
  for (const transposed of [false, true]) {
    for (let i = 0; i < size; i++) {
      const line = []
      for (let j = 0; j < size; j++) line.push(transposed ? m[j][i] : m[i][j])

      let runColour = line[0]
      let runLength = 1
      for (let j = 1; j < size; j++) {
        if (line[j] === runColour) {
          runLength++
        } else {
          if (runLength >= 5) score += 3 + (runLength - 5)
          runColour = line[j]
          runLength = 1
        }
      }
      if (runLength >= 5) score += 3 + (runLength - 5)

      for (let j = 0; j + 11 <= size; j++) {
        const w = line.slice(j, j + 11)
        const core = w.slice(0, 7).join('') === '1011101'
        const tail = w.slice(7).join('') === '0000'
        const head = w.slice(0, 4).join('') === '0000'
        const core2 = w.slice(4).join('') === '1011101'
        if ((core && tail) || (head && core2)) score += 40
      }
    }
  }

  // rule 2: 2x2 blocks of one colour
  for (let r = 0; r + 1 < size; r++) {
    for (let c = 0; c + 1 < size; c++) {
      const v = m[r][c]
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3
    }
  }

  // rule 4: overall balance of dark and light
  let dark = 0
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c]
  const percent = (dark * 100) / (size * size)
  score += Math.floor(Math.abs(percent - 50) / 5) * 10

  return score
}

function formatBits(level, mask) {
  const levelBits = level === 'L' ? 0b01 : 0b00 // L = 01, M = 00
  const data = (levelBits << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}

function versionBits(version) {
  let rem = version
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (version << 12) | rem
}

function writeFormat(m, size, level, mask) {
  const bits = formatBits(level, mask)
  const get = (i) => (bits >>> i) & 1

  // First copy: down column 8, then left along row 8.
  for (let i = 0; i <= 5; i++) m[i][8] = get(i)
  m[7][8] = get(6)
  m[8][8] = get(7)
  m[8][7] = get(8)
  for (let i = 9; i <= 14; i++) m[8][14 - i] = get(i)

  // Second copy: right along row 8, then up column 8.
  for (let i = 0; i <= 7; i++) m[8][size - 1 - i] = get(i)
  for (let i = 8; i <= 14; i++) m[size - 15 + i][8] = get(i)
  m[size - 8][8] = 1
}

function writeVersion(m, size, version) {
  if (version < 7) return
  const bits = versionBits(version)
  for (let i = 0; i < 18; i++) {
    const bit = (bits >>> i) & 1
    const r = Math.floor(i / 3)
    const c = size - 11 + (i % 3)
    m[r][c] = bit
    m[c][r] = bit
  }
}

/** The codeword stream, before it is laid into a matrix. */
function encodeCodewords(text, level = 'L') {
  const bytes = Array.from(new TextEncoder().encode(text))
  const version = pickVersion(bytes.length, level)
  const pre = toCodewords(bytes, version, level)
  return { version, pre, final: interleave(pre, version, level) }
}

/**
 * Returns the QR modules as an array of rows of 0/1, without a quiet zone.
 */
export function encode(text, level = 'L') {
  const bytes = Array.from(new TextEncoder().encode(text))
  const version = pickVersion(bytes.length, level)
  const codewords = interleave(toCodewords(bytes, version, level), version, level)

  const { m, reserved, size } = buildFunctionPatterns(version)
  placeData(m, reserved, size, codewords)

  let best = null
  for (let mask = 0; mask < 8; mask++) {
    const candidate = m.map((row) => row.slice())
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!reserved[r][c] && maskBit(mask, r, c)) candidate[r][c] ^= 1
      }
    }
    writeFormat(candidate, size, level, mask)
    writeVersion(candidate, size, version)
    const score = penalty(candidate, size)
    if (!best || score < best.score) best = { score, mask, matrix: candidate }
  }

  return { version, mask: best.mask, size, matrix: best.matrix }
}

/** A self-contained SVG. `size` is the rendered edge length in px. */
export function qrSVG(text, { level = 'L', size = 220, quiet = 4 } = {}) {
  const { matrix, size: n } = encode(text, level)
  const dim = n + quiet * 2

  let path = ''
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"`,
    ` viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img"`,
    ` aria-label="QR code">`,
    `<rect width="${dim}" height="${dim}" fill="#fff"/>`,
    `<path d="${path}" fill="#000"/>`,
    `</svg>`,
  ].join('')
}

/**
 * Internals, exported only so test.mjs can check each stage on its own:
 * the Reed–Solomon step against a published vector, and the placed matrix
 * read back into codewords.
 */
export const _internals = {
  rsRemainder,
  buildFunctionPatterns,
  maskBit,
  encodeCodewords,
}
