/**
 * xoroshiro64++ PRNG — pure TypeScript port of the WGSL implementation.
 * Seedable, deterministic, used for reproducible server-side renders.
 */

export class Xoroshiro64 {
  private s0: number
  private s1: number

  constructor(seed: number) {
    this.s0 = seed >>> 0
    this.s1 = (seed * 0x9e3779b9) >>> 0
  }

  /** 32-bit unsigned integer */
  nextU32(): number {
    const s0 = this.s0
    let s1 = this.s1
    const result = (rotl((s0 + s1) >>> 0, 7) + s0) >>> 0

    s1 ^= s0
    this.s0 = (rotl(s0, 24) ^ s1 ^ (s1 << 16)) >>> 0
    this.s1 = rotl(s1, 37)
    return result
  }

  /** Float in [0, 1) */
  next(): number {
    return (this.nextU32() >>> 8) / 0x1000000
  }

  /** Float in [a, b) */
  range(a: number, b: number): number {
    return a + this.next() * (b - a)
  }

  /** Random point in unit disk */
  unitDisk(): [number, number] {
    const r = Math.sqrt(this.next())
    const theta = this.next() * Math.PI * 2
    return [r * Math.cos(theta), r * Math.sin(theta)]
  }
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0
}

/** Simple string hash for seeding */
export function hashString(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0
  }
  return hash
}
