/** Leaf mesh and interaction contracts shared by gummy solver preparation and material stages. */
export type GummySolverMesh = {
  /** xyzw, with w the inverse mass; zero pins a node. */
  positions: Float32Array
  tetrahedra: Uint32Array
  /** Three duplicate-node pairs per face: a0,b0,a1,b1,a2,b2,pad,pad. */
  interfaces: Uint32Array
  nodeRegions?: Uint32Array
  spacing?: number
}
export type GummyGrip = {
  center: readonly [number, number, number]
  target: readonly [number, number, number]
  radius: number
}
export type GummyPress = { height: number; halfExtent: number }
export type GummyStep = {
  grip?: GummyGrip
  press?: GummyPress
  softness: number
  tearing: boolean
  /** Optional fine-seam calibration. One preserves the pull study's strength. */
  cohesiveStrength?: number
  /** Opt-in nodal sphere contact; ignored if the mesh has no fracture-region metadata. */
  fragmentContact?: boolean
  /** Fine mode also completes failure of predefined seam patches with >=70% broken rest area. */
  fractureMode?: 'tension-shear' | 'legacy'
}
