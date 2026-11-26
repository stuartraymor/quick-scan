// SPDX-License-Identifier: AGPL-3.0-only
// Part of a TypeScript port of Instant Meshes ("Instant Field-Aligned Meshes").
// Copyright (c) 2015 Wenzel Jakob, Daniele Panozzo, Marco Tarini, and Olga Sorkine-Hornung
// (BSD-3-Clause; the licence text is in ATTRIBUTION.md).
//
// Helpers shared by the port: a seeded generator, a stable radix sort of float
// keys (the port's stand-in for parallel_stable_sort), a clock and the
// progress reporter.

export const INVALID = 0xffffffff

/** Instant Meshes' RCPOVERFLOW: the smallest length it will divide by. */
export const RCPOVERFLOW = 2.93873587705571876e-39

export type InstantStage = 'prepare' | 'hierarchy' | 'orientation' | 'position' | 'extract' | 'smooth'

export const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? () => performance.now() : () => Date.now()

/** A fraction 0..1 of one step of a stage, reported from inside its loops. */
export type Tick = (fraction: number) => void
export const noTick: Tick = () => {}
/** How many iterations of a cheap loop pass between two ticks (as a mask). */
export const TICK_MASK = 16383

/**
 * Throttled progress: the callback is called at most every few milliseconds,
 * the fraction never goes back within a stage, and whatever the callback
 * throws propagates.
 */
export class Progress {
  private last = -Infinity
  private stage: InstantStage | '' = ''
  private fraction = 0
  constructor(private readonly callback: ((stage: InstantStage, fraction: number) => void) | undefined) {}
  private send(stage: InstantStage, fraction: number, t: number): void {
    if (!(fraction >= 0)) fraction = 0
    else if (fraction > 1) fraction = 1
    if (stage !== this.stage) this.stage = stage
    else if (fraction < this.fraction) fraction = this.fraction
    this.fraction = fraction
    this.last = t
    this.callback!(stage, fraction)
  }
  /** Report unconditionally (stage boundaries). */
  report(stage: InstantStage, fraction: number): void {
    if (this.callback) this.send(stage, fraction, now())
  }
  /** Report if enough time has passed since the last report. */
  tick(stage: InstantStage, fraction: number): void {
    if (!this.callback) return
    const t = now()
    if (t - this.last >= 8) this.send(stage, fraction, t)
  }
  /** The ticks of one step of a stage: its 0..1 mapped to from..to of the stage. */
  part(stage: InstantStage, from: number, to: number): Tick {
    if (!this.callback) return noTick
    return fraction => this.tick(stage, from + (to - from) * fraction)
  }
}

/** mulberry32: a small seeded generator (Instant Meshes uses pcg32; only determinism matters). */
export class Rng {
  private s: number
  constructor(seed: number) { this.s = (seed | 0) ^ 0x9e3779b9 }
  /** A float in [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  /** An integer in [0, n). */
  below(n: number): number { return Math.floor(this.next() * n) }
}

/** The permutation that sorts the unsigned keys `bits[0..n)` — stable, ascending. Three 11-bit radix passes. */
export function sortU32Keys(bits: Uint32Array, n: number, tick: Tick = noTick): Uint32Array {
  let src = new Uint32Array(n)
  let dst = new Uint32Array(n)
  for (let i = 0; i < n; i++) src[i] = i
  const count = new Uint32Array(2048)
  for (let pass = 0; pass < 3; pass++) {
    const shift = pass * 11
    count.fill(0)
    tick(pass / 3)
    for (let i = 0; i < n; i++) count[(bits[i] >>> shift) & 2047]++
    tick((pass + 0.3) / 3)
    let sum = 0
    for (let b = 0; b < 2048; b++) { const c = count[b]; count[b] = sum; sum += c }
    for (let i = 0; i < n; i++) {
      const id = src[i]
      dst[count[(bits[id] >>> shift) & 2047]++] = id
    }
    const t = src; src = dst; dst = t
  }
  return src
}

/**
 * The permutation that sorts `keys[0..n)` (float32) — stable; ascending, or
 * descending when asked.
 */
export function sortFloatKeys(keys: Float32Array, n: number, descending: boolean, tick: Tick = noTick): Uint32Array {
  const bits = new Uint32Array(n)
  const view = new Uint32Array(keys.buffer, keys.byteOffset, n)
  for (let i = 0; i < n; i++) {
    const b = view[i]
    // Flip so that unsigned order is float order.
    let u = (b & 0x80000000) !== 0 ? ~b >>> 0 : (b | 0x80000000) >>> 0
    if (descending) u = ~u >>> 0
    bits[i] = u
  }
  return sortU32Keys(bits, n, tick)
}

export function growU32(a: Uint32Array, size: number): Uint32Array {
  if (a.length >= size) return a
  const b = new Uint32Array(Math.max(size, a.length * 2))
  b.set(a)
  return b
}
export function growF64(a: Float64Array, size: number): Float64Array {
  if (a.length >= size) return a
  const b = new Float64Array(Math.max(size, a.length * 2))
  b.set(a)
  return b
}
export function growU8(a: Uint8Array, size: number): Uint8Array {
  if (a.length >= size) return a
  const b = new Uint8Array(Math.max(size, a.length * 2))
  b.set(a)
  return b
}

/** coordinate_system(): two unit tangents s, t of the unit normal n, with s × t = n. Written to out[0..6). */
export function coordinateSystem(nx: number, ny: number, nz: number, out: Float64Array): void {
  let cx: number, cy: number, cz: number
  if (Math.abs(nx) > Math.abs(ny)) {
    const inv = 1 / Math.sqrt(nx * nx + nz * nz)
    cx = nz * inv; cy = 0; cz = -nx * inv
  } else {
    const inv = 1 / Math.sqrt(ny * ny + nz * nz)
    cx = 0; cy = nz * inv; cz = -ny * inv
  }
  // b = c × a
  out[0] = cy * nz - cz * ny
  out[1] = cz * nx - cx * nz
  out[2] = cx * ny - cy * nx
  out[3] = cx; out[4] = cy; out[5] = cz
}
