// SPDX-License-Identifier: AGPL-3.0-only
/** Orientation gizmo, drawn into a corner viewport of the same canvas. The
 *  arrows are also buttons: hovering one lights it, and a click turns the
 *  camera to look down that axis — see hitTest and SceneManager. */
import * as THREE from 'three'

export type GizmoAxis = 'x' | 'y' | 'z'
/** A cube face selects that signed world direction; arrow tips keep their
 *  existing unsigned-axis behavior. */
export type GizmoTarget = GizmoAxis | `+${GizmoAxis}` | `-${GizmoAxis}`

/** The colour each axis is drawn in — here, and wherever else the scan's
 *  axes are shown, like the coordinate planes a section is offered. */
export const AXIS_COLORS: Record<GizmoAxis, number> = { x: 0xcc0000, y: 0x18bd36, z: 0x0000cc }

const GIZMO_AXES: [GizmoAxis, THREE.Vector3, number, string][] = [
  ['x', new THREE.Vector3(1, 0, 0), AXIS_COLORS.x, 'X'],
  ['y', new THREE.Vector3(0, 1, 0), AXIS_COLORS.y, 'Y'],
  ['z', new THREE.Vector3(0, 0, 1), AXIS_COLORS.z, 'Z'],
]

/** Half-extent of the gizmo camera, in gizmo units. */
const GIZMO_HALF = 1.35
/** Where along an arrow its button lives — between the head and the letter —
 *  and how far from there still counts, in gizmo units. */
const TIP_AT = 1.1
const TIP_RADIUS = 0.45

/** Gap between the gizmo and the two edges it sits in. */
const GIZMO_PAD = 14

/** How big the corner it occupies is, for a canvas of this size. Exported
 *  because the fit-to-view button parks directly above it, and a button that
 *  guessed would either overlap the gizmo or float away from it. */
export function gizmoSize(w: number, h: number): number {
  return Math.min(104, Math.max(74, Math.min(w, h) * 0.18))
}

/** Canvas-textured letter for an axis tip. */
function axisLabel(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0')
  ctx.font = 'bold 46px Barlow, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 32, 34)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true }),
  )
  sprite.scale.setScalar(0.5)
  return sprite
}

export class AxisGizmo {
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(
    -GIZMO_HALF,
    GIZMO_HALF,
    GIZMO_HALF,
    -GIZMO_HALF,
    0.1,
    12,
  )
  private disposables: { dispose(): void }[] = []
  private cube: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial[]>
  // BoxGeometry groups: +X, -X, +Y, -Y, +Z, -Z.
  private cubeFaces: GizmoTarget[] = ['+x', '-x', '+y', '-y', '+z', '-z']
  private cubeColors = [0xc2c7cd, 0x8d959e, 0xe2e5e9, 0xa4abb3, 0xd1d6dc, 0x9aa2ab]
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private arrows: {
    axis: GizmoAxis
    dir: THREE.Vector3
    color: number
    material: THREE.MeshBasicMaterial
    label: THREE.Sprite
  }[] = []
  /** The arrow under the cursor, lit — see setHovered. */
  private hovered: GizmoTarget | null = null
  /** Where the gizmo was last drawn, in canvas pixels from the top-left, so a
   *  pointer can be tested against it. Empty until the first frame. */
  private drawn = { x: 0, y: 0, size: 0 }
  /** Settings → Navigation → Use navigation cube for setting standard views: off, nothing is drawn or hit. */
  private shown = true
  setShown(on: boolean): void {
    this.shown = on
    if (!on) this.drawn = { x: 0, y: 0, size: 0 }
  }
  private tmp = new THREE.Vector3()

  constructor() {
    // The common origin is a cube corner, so the neutral cube grows into
    // positive XYZ and the colored axes project from that same corner.
    const cubeGeometry = new THREE.BoxGeometry(0.72, 0.72, 0.72)
    const cubeMaterials = this.cubeColors.map(color => new THREE.MeshBasicMaterial({ color }))
    this.cube = new THREE.Mesh(cubeGeometry, cubeMaterials)
    this.cube.position.set(0.36, 0.36, 0.36)
    this.scene.add(this.cube)
    this.disposables.push(cubeGeometry, ...cubeMaterials)
    const cubeEdges = new THREE.EdgesGeometry(cubeGeometry)
    const cubeStroke = new THREE.LineBasicMaterial({ color: 0xe6eaf0, transparent: true, opacity: 0.8 })
    const edges = new THREE.LineSegments(cubeEdges, cubeStroke)
    edges.position.copy(this.cube.position)
    this.scene.add(edges)
    this.disposables.push(cubeEdges, cubeStroke)
    const shaft = new THREE.CylinderGeometry(0.035, 0.035, 0.72, 8)
    shaft.translate(0, 0.36, 0)
    const head = new THREE.ConeGeometry(0.1, 0.26, 12)
    head.translate(0, 0.85, 0)
    this.disposables.push(shaft, head)

    const y = new THREE.Vector3(0, 1, 0)
    for (const [axis, dir, color, text] of GIZMO_AXES) {
      const mat = new THREE.MeshBasicMaterial({ color })
      this.disposables.push(mat)
      const q = new THREE.Quaternion().setFromUnitVectors(y, dir)
      for (const geo of [shaft, head]) {
        const part = new THREE.Mesh(geo, mat)
        part.quaternion.copy(q)
        this.scene.add(part)
      }
      const label = axisLabel(text.toLowerCase(), color)
      label.position.copy(dir).multiplyScalar(1.3)
      this.scene.add(label)
      this.disposables.push(label.material, label.material.map!)
      this.arrows.push({ axis, dir, color, material: mat, label })
    }
  }

  /** The arrow under a canvas point (pixels from the canvas's top-left), or
   *  null. Tested against the last drawn frame: the gizmo shares the main
   *  camera's orientation, and that is where the arrows were on screen.
   *  Where two tips overlap, the one nearer the viewer wins — it is the one
   *  drawn on top. */
  hitTest(px: number, py: number): GizmoTarget | null {
    const { x, y, size } = this.drawn
    if (size === 0 || px < x || py < y || px > x + size || py > y + size) return null
    const unit = size / (2 * GIZMO_HALF)
    this.camera.updateMatrixWorld()
    this.scene.updateMatrixWorld(true)
    this.pointer.set(((px - x) / size) * 2 - 1, 1 - ((py - y) / size) * 2)
    this.raycaster.setFromCamera(this.pointer, this.camera)
    const face = this.raycaster.intersectObject(this.cube, false)[0]?.face
    if (face) return this.cubeFaces[face.materialIndex]
    let best: GizmoAxis | null = null
    let bestDepth = Infinity
    for (const a of this.arrows) {
      // Camera space: x right, y up, z toward the viewer — -z is depth.
      const tip = this.tmp
        .copy(a.dir)
        .multiplyScalar(TIP_AT)
        .applyMatrix4(this.camera.matrixWorldInverse)
      const sx = x + size / 2 + tip.x * unit
      const sy = y + size / 2 - tip.y * unit
      if (Math.hypot(px - sx, py - sy) > TIP_RADIUS * unit) continue
      const depth = -tip.z
      if (depth < bestDepth) {
        bestDepth = depth
        best = a.axis
      }
    }
    return best
  }

  /** Light one arrow, or none. Returns whether anything changed, so the
   *  owner knows to redraw. */
  setHovered(axis: GizmoTarget | null): boolean {
    if (this.hovered === axis) return false
    this.hovered = axis
    for (let i = 0; i < this.cube.material.length; i++) {
      this.cube.material[i].color.setHex(this.cubeColors[i])
      if (this.cubeFaces[i] === axis) this.cube.material[i].color.lerp(new THREE.Color(0xffffff), 0.45)
    }
    for (const a of this.arrows) {
      const lit = a.axis === axis
      a.material.color.setHex(a.color)
      if (lit) a.material.color.lerp(new THREE.Color(0xffffff), 0.45)
      a.label.scale.setScalar(lit ? 0.6 : 0.5)
    }
    return true
  }

  /** Draw the gizmo into a top-right corner of the given canvas, sharing
   *  the main camera's orientation so it reads as the part's world axes.
   *  Returns the size of the corner it took. */
  render(
    renderer: THREE.WebGLRenderer,
    mainCamera: THREE.Camera,
    target: THREE.Vector3,
    w: number,
    h: number,
  ): number {
    if (!this.shown) return 0
    const size = gizmoSize(w, h)
    const pad = GIZMO_PAD
    this.camera.position
      .subVectors(mainCamera.position, target)
      .normalize()
      .multiplyScalar(6)
      .add(this.cube.position)
    this.camera.quaternion.copy(mainCamera.quaternion)

    this.drawn = { x: w - size - pad, y: pad, size }

    renderer.autoClear = false
    renderer.setViewport(w - size - pad, h - size - pad, size, size)
    renderer.setScissor(w - size - pad, h - size - pad, size, size)
    renderer.setScissorTest(true)
    renderer.clearDepth()
    renderer.render(this.scene, this.camera)
    renderer.setScissorTest(false)
    renderer.autoClear = true
    return size
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
  }
}
