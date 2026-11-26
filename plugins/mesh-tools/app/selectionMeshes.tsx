// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react'
import { create } from 'zustand'
import * as THREE from 'three'
import type { ProjectSection } from '../../../src/app/projectSections'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import { compactEdit, markedTriangles } from '../core/edit'
import { rigidApplyToPoints, rigidInvert } from '../../../src/core/deviation/rigid'
import { useStore } from '../../../src/state/store'
import { historyAsync, historyBlocked, registerHistory } from '../../../src/state/historyStore'
import { onScan } from '../../../src/app/scanEvents'

type Piece = { name: string; shown: boolean; positions: Float32Array; indices: Uint32Array }
export const usePieces = create<{ pieces: Piece[] }>(() => ({ pieces: [] }))

export function installSelectionMeshes() {
  onScan({ loaded: () => usePieces.setState({ pieces: [] }) })
  registerHistory({ sections: [{ key: 'selectionMeshes', capture: () => usePieces.getState().pieces,
    apply: pieces => usePieces.setState({ pieces: pieces as Piece[] }), compare: 'identity' }] })
}

export async function createSelectionMesh(scene: SceneManager | null, cut?: (marked: Uint32Array) => Promise<unknown>) {
  if (!scene || historyBlocked()) return
  const geometry = scene.scanGeometry()
  const pos = geometry?.getAttribute('position')
  const faces = geometry?.getIndex()
  if (!pos || !faces) return
  const marked = scene.paintedVertices()
  const indices = Uint32Array.from(faces.array)
  const { mask, count } = markedTriangles(indices, marked, pos.count)
  if (!count || (cut && count === indices.length / 3)) {
    useStore.getState().setError(count ? 'Cut requires triangles to remain in the source mesh.' : 'Select complete triangles first.')
    return
  }
  const subset = indices.filter((_, i) => mask[Math.floor(i / 3)] === 1)
  const { positions, indices: triangles } = compactEdit(pos.array as Float32Array, subset, pos.count)
  const alignment = useStore.getState().appliedAlignment
  if (alignment) rigidApplyToPoints(rigidInvert(alignment),positions)
  await historyAsync(cut ? 'Cut & Create' : 'Copy & Create', async () => {
    if (cut && !await cut(marked)) return
    usePieces.setState(s => ({ pieces: [...s.pieces, { name: `Mesh ${s.pieces.length + 1}`, shown: true, positions, indices: triangles }] }))
    useStore.getState().setStatus(`Created a mesh from ${count.toLocaleString()} selected triangles.`)
  })
}

export function SelectionMeshes({ scene }: { scene: SceneManager | null }) {
  const pieces = usePieces(s => s.pieces)
  const alignment = useStore(s => s.appliedAlignment)
  useEffect(() => {
    if (!scene || !pieces.length) return
    const host = scene.layerHost()
    const objects = pieces.filter(p => p.shown).map(p => {
      const g = new THREE.BufferGeometry()
      const positions = alignment ? p.positions.slice() : p.positions
      if (alignment) rigidApplyToPoints(alignment,positions)
      g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      g.setIndex(new THREE.BufferAttribute(p.indices, 1))
      g.computeVertexNormals()
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({color: '#b5a89a', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1}))
      host.partGroup.add(m)
      return m
    })
    host.invalidate()
    return () => {
      for (const m of objects) { m.removeFromParent(); m.geometry.dispose(); m.material.dispose() }
      host.invalidate()
    }
  }, [pieces, scene, alignment])
  return <>{pieces.map((p,i) => <label className="explorer-row" key={i} data-test="selection-mesh-object">
    <input type="checkbox" checked={p.shown} onChange={() => usePieces.setState({pieces: pieces.map((v,j) => i === j ? {...v,shown: !v.shown} : v)})}/>{p.name}
  </label>)}</>
}

type Entry = { name: string; shown: boolean; vertices: number; triangles: number }
const pointsMember = 'selection-mesh-points.bin'
const facesMember = 'selection-mesh-triangles.bin'
const legacyFile = (i: number, field: string) => `selection-mesh-${i}-${field}.bin`

// Share one member per buffer type so a new object does not consume more
// entries from the project archive's member limit.
function joinPieces(pieces: Piece[], field: 'positions' | 'indices'): Uint8Array {
  const joined = new Uint8Array(pieces.reduce((n,p) => n + p[field].byteLength, 0))
  let offset = 0
  for (const piece of pieces) {
    const source = piece[field]
    joined.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength), offset)
    offset += source.byteLength
  }
  return joined
}

export const selectionMeshSection: ProjectSection<Entry[]> = {
  key: 'selectionMeshes',
  collect({scanSaved, addMember}) {
    const {pieces} = usePieces.getState()
    if (!scanSaved || !pieces.length) return undefined
    addMember(pointsMember, joinPieces(pieces, 'positions'))
    addMember(facesMember, joinPieces(pieces, 'indices'))
    return pieces.map(p => ({ name: p.name, shown: p.shown, vertices: p.positions.length/3, triangles: p.indices.length/3 }))
  },
  members: rows => rows.length && rows[0].vertices !== undefined ? [pointsMember, facesMember] :
    rows.flatMap((_,i) => [legacyFile(i,'points'), legacyFile(i,'triangles')]),
  prepare(value,{members}) {
    if (value === undefined) return () => usePieces.setState({pieces:[]})
    if (!Array.isArray(value)) throw Error('Invalid selection meshes')
    const allPoints = members.get(pointsMember), allFaces = members.get(facesMember)
    let pointOffset = 0, faceOffset = 0
    const pieces = value.map((row,i) => {
      if (typeof row?.name !== 'string' || typeof row.shown !== 'boolean') throw Error('Invalid selection mesh')
      let points: Uint8Array | undefined, faces: Uint8Array | undefined
      if (row.vertices === undefined && row.triangles === undefined && !allPoints && !allFaces) {
        points = members.get(legacyFile(i,'points'))
        faces = members.get(legacyFile(i,'triangles'))
      } else {
        if (!allPoints || !allFaces || !Number.isSafeInteger(row.vertices) || row.vertices <= 0 ||
            !Number.isSafeInteger(row.triangles) || row.triangles <= 0 ||
            row.vertices > (allPoints.length-pointOffset)/12 || row.triangles > (allFaces.length-faceOffset)/12)
          throw Error('Invalid selection mesh sizes')
        points = allPoints.subarray(pointOffset, pointOffset + row.vertices*12)
        faces = allFaces.subarray(faceOffset, faceOffset + row.triangles*12)
        pointOffset += points.length
        faceOffset += faces.length
      }
      if (!points?.length || !faces?.length || points.length%12 || faces.length%12) throw Error('Invalid selection mesh')
      const positions = new Float32Array(points.slice().buffer), indices = new Uint32Array(faces.slice().buffer)
      if (!positions.every(Number.isFinite) || indices.some(v => v >= positions.length/3)) throw Error('Invalid selection mesh geometry')
      return { name: row.name, shown: row.shown, positions, indices }
    })
    if (pointOffset !== (allPoints?.length ?? 0) || faceOffset !== (allFaces?.length ?? 0)) throw Error('Invalid selection mesh buffer length')
    return () => usePieces.setState({pieces})
  },
  holdsWork: () => usePieces.getState().pieces.length > 0,
  watch: changed => usePieces.subscribe(changed),
}
