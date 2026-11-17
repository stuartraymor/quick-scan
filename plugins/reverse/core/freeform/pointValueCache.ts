// SPDX-License-Identifier: AGPL-3.0-only
/** Exact Float32 XYZ keys without decimal-string allocation. Two reusable
 * generations bound memory and avoid clearing a large JS Map during a drag. */
export function pointValueCache(capacity: number) {
  const slots = 2 ** Math.ceil(Math.log2(capacity * 2)), mask = slots - 1
  const hash = (x: number, y: number, z: number) => {
    let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ Math.imul(z, 0xc2b2ae35)
    h = Math.imul(h ^ h >>> 16, 0x85ebca6b)
    return (h ^ h >>> 13) & mask
  }
  const table = () => {
    const keys = new Uint32Array(slots * 3), values = new Float32Array(slots), used = new Uint8Array(slots)
    let count = 0
    const locate = (x: number, y: number, z: number) => {
      let i = hash(x,y,z)
      while (used[i] && (keys[i*3] !== x || keys[i*3+1] !== y || keys[i*3+2] !== z)) i = (i+1) & mask
      return i
    }
    return {
      get(x: number,y: number,z: number) { const i=locate(x,y,z); return used[i] ? values[i] : undefined },
      set(x: number,y: number,z: number,value: number) {
        const i=locate(x,y,z)
        if (!used[i]) { used[i]=1; count++ }
        keys[i*3]=x;keys[i*3+1]=y;keys[i*3+2]=z;values[i]=value
      },
      get full() { return count >= capacity },
      clear() { used.fill(0); count=0 },
    }
  }
  let current=table(), previous=table()
  return {
    get(x: number,y: number,z: number) {
      const value=current.get(x,y,z)
      if (value !== undefined) return value
      const retained=previous.get(x,y,z)
      if (retained !== undefined) this.set(x,y,z,retained)
      return retained
    },
    set(x: number,y: number,z: number,value: number) {
      if (current.full) { const next=previous; previous=current; current=next; current.clear() }
      current.set(x,y,z,value)
    },
  }
}
