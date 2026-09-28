/**
 * A small QR code encoder (ISO/IEC 18004, byte mode only), enough for `otpauth://` URLs.
 * It follows Project Nayuki's reference implementation (MIT): pick the smallest version
 * for the error correction level, add Reed-Solomon codewords, draw, and keep the mask
 * with the lowest penalty.
 */

export type QrLevel = 'L' | 'M' | 'Q' | 'H';

/** A QR code: `modules[y][x]` is true for a dark module. No quiet zone. */
export interface QrCode {
  version: number;
  size: number;
  mask: number;
  modules: boolean[][];
}

const LEVEL_INDEX: Record<QrLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };
/** The two format bits of each level. */
const LEVEL_BITS: Record<QrLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

// Indexed by level, then version (index 0 is unused).
const ECC_CODEWORDS_PER_BLOCK = [
  [
    -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30,
    30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  [
    -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
  [
    -1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30,
    30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  [
    -1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
];
const ECC_BLOCKS = [
  [
    -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14,
    15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
  ],
  [
    -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23,
    25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  [
    -1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34,
    34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  [
    -1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35,
    37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
];

/** Modules available for data and error correction in a version. */
function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(version: number, level: number): number {
  return (
    Math.floor(rawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[level][version] * ECC_BLOCKS[level][version]
  );
}

/** GF(2^8) product modulo x^8 + x^4 + x^3 + x^2 + 1. */
function multiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = multiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = multiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coefficient, i) => (result[i] ^= multiply(coefficient, factor)));
  }
  return result;
}

function bit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0;
}

class Grid {
  readonly size: number;
  readonly modules: boolean[][];
  readonly reserved: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
    this.reserved = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
  }

  set(x: number, y: number, dark: boolean): void {
    this.modules[y][x] = dark;
    this.reserved[y][x] = true;
  }

  alignmentPositions(): number[] {
    if (this.version === 1) return [];
    const count = Math.floor(this.version / 7) + 2;
    const step = Math.floor((this.version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
    const result = [6];
    for (let position = this.size - 7; result.length < count; position -= step)
      result.splice(1, 0, position);
    return result;
  }

  drawFunctionPatterns(level: QrLevel): void {
    for (let i = 0; i < this.size; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(this.size - 4, 3);
    this.finder(3, this.size - 4);
    const positions = this.alignmentPositions();
    const count = positions.length;
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < count; j++) {
        const corner =
          (i === 0 && j === 0) || (i === 0 && j === count - 1) || (i === count - 1 && j === 0);
        if (!corner) this.alignment(positions[i], positions[j]);
      }
    }
    this.drawFormat(level, 0);
    this.drawVersion();
  }

  private finder(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size)
          this.set(xx, yy, distance !== 2 && distance !== 4);
      }
    }
  }

  private alignment(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        this.set(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }

  drawFormat(level: QrLevel, mask: number): void {
    const data = (LEVEL_BITS[level] << 3) | mask;
    let remainder = data;
    for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
    const bits = ((data << 10) | remainder) ^ 0x5412;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(bits, i));
    this.set(8, 7, bit(bits, 6));
    this.set(8, 8, bit(bits, 7));
    this.set(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.set(this.size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.set(8, this.size - 15 + i, bit(bits, i));
    this.set(8, this.size - 8, true);
  }

  private drawVersion(): void {
    if (this.version < 7) return;
    let remainder = this.version;
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (this.version << 12) | remainder;
    for (let i = 0; i < 18; i++) {
      const dark = bit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.set(a, b, dark);
      this.set(b, a, dark);
    }
  }

  drawCodewords(data: readonly number[]): void {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < this.size; vertical++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vertical : vertical;
          if (!this.reserved[y][x] && i < data.length * 8) {
            this.modules[y][x] = bit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.reserved[y][x] && masked(mask, x, y)) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  /** The penalty of the current modules (rules N1 to N4 of the standard). */
  penalty(): number {
    const size = this.size;
    const at = (x: number, y: number) => this.modules[y][x];
    let result = 0;
    const lines: boolean[][] = [];
    for (let y = 0; y < size; y++) lines.push(this.modules[y]);
    for (let x = 0; x < size; x++) lines.push(this.modules.map((row) => row[x]));
    const finderLike = [true, false, true, true, true, false, true];
    for (const line of lines) {
      let run = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && line[i] === line[i - 1]) run++;
        else {
          if (run >= 5) result += run - 2;
          run = 1;
        }
      }
      for (let i = 0; i + 7 <= size; i++) {
        if (!finderLike.every((dark, k) => line[i + k] === dark)) continue;
        const light = (from: number, to: number) => {
          for (let k = from; k < to; k++) if (k >= 0 && k < size && line[k]) return false;
          return true;
        };
        if (light(i - 4, i)) result += 40;
        if (light(i + 7, i + 11)) result += 40;
      }
    }
    let dark = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (at(x, y)) dark++;
        if (
          x + 1 < size &&
          y + 1 < size &&
          at(x, y) === at(x + 1, y) &&
          at(x, y) === at(x, y + 1) &&
          at(x, y) === at(x + 1, y + 1)
        )
          result += 3;
      }
    }
    const total = size * size;
    result += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
    return result;
  }
}

function masked(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** The data codewords of `bytes` in byte mode, padded to the capacity of `version`. */
function encodeData(bytes: Uint8Array, version: number, level: number): number[] | null {
  const capacity = dataCodewords(version, level) * 8;
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  if (bits.length > capacity) return null;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8)
    codewords.push(bits.slice(i, i + 8).reduce((byte, value) => (byte << 1) | value, 0));
  for (let pad = 0xec; codewords.length < capacity / 8; pad ^= 0xec ^ 0x11) codewords.push(pad);
  return codewords;
}

/** Splits the data into blocks, adds their error correction and interleaves them. */
function withErrorCorrection(data: readonly number[], version: number, level: number): number[] {
  const blocks = ECC_BLOCKS[level][version];
  const eccLength = ECC_CODEWORDS_PER_BLOCK[level][version];
  const raw = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const divisor = rsDivisor(eccLength);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const block = data.slice(k, k + shortLength - eccLength + (i < shortBlocks ? 0 : 1));
    k += block.length;
    const ecc = rsRemainder(block, divisor);
    if (i < shortBlocks) block.push(0);
    all.push([...block, ...ecc]);
  }
  const result: number[] = [];
  for (let i = 0; i < all[0].length; i++) {
    all.forEach((block, j) => {
      if (i !== shortLength - eccLength || j >= shortBlocks) result.push(block[i]);
    });
  }
  return result;
}

/**
 * Encodes `text` (UTF-8) as a QR code. `mask` forces a mask pattern (0–7); otherwise the
 * one with the lowest penalty is used. Throws when the text does not fit version 40.
 */
export function encodeQr(text: string, level: QrLevel = 'M', mask?: number): QrCode {
  const bytes = new TextEncoder().encode(text);
  const index = LEVEL_INDEX[level];
  for (let version = 1; version <= 40; version++) {
    const data = encodeData(bytes, version, index);
    if (!data) continue;
    const codewords = withErrorCorrection(data, version, index);
    const grid = new Grid(version);
    grid.drawFunctionPatterns(level);
    grid.drawCodewords(codewords);
    let chosen = mask ?? -1;
    if (chosen < 0) {
      let best = Infinity;
      for (let candidate = 0; candidate < 8; candidate++) {
        grid.applyMask(candidate);
        grid.drawFormat(level, candidate);
        const penalty = grid.penalty();
        if (penalty < best) {
          best = penalty;
          chosen = candidate;
        }
        grid.applyMask(candidate);
      }
    }
    grid.applyMask(chosen);
    grid.drawFormat(level, chosen);
    return { version, size: grid.size, mask: chosen, modules: grid.modules };
  }
  throw new Error('The text is too long for a QR code');
}

/** An SVG path drawing the dark modules, one unit per module, offset by `margin`. */
export function qrPath(code: QrCode, margin = 4): string {
  const parts: string[] = [];
  code.modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x + margin} ${y + margin}h1v1h-1z`);
    }),
  );
  return parts.join('');
}
