/** Analytic fixtures prove the fracture probe detects point bridges, missing caps and flipped winding. */
import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeRuntimeJelly } from './gummy-jelly-topology-checks.mjs'

const exterior = 0xffffffff
const tear = 0xfffffffe
const xyz = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1]
const sharedSurface = [
  [0, 1, 3],
  [0, 3, 2],
  [1, 2, 3],
  [0, 2, 4],
  [0, 4, 1],
  [2, 1, 4],
].flatMap((face) => [...face, exterior])

function fixture(split = false) {
  const original = split ? [0, 1, 2, 3, 4, 0, 1, 2] : [0, 1, 2, 3, 4]
  const rest = original.flatMap((id) => [
    ...xyz.slice(id * 3, id * 3 + 3),
    split && id < 3 ? 2 : 1,
  ])
  const surface = split
    ? [
        0,
        1,
        3,
        exterior,
        0,
        3,
        2,
        exterior,
        1,
        2,
        3,
        exterior,
        5,
        7,
        4,
        exterior,
        5,
        4,
        6,
        exterior,
        7,
        6,
        4,
        exterior,
        0,
        2,
        1,
        tear,
        5,
        6,
        7,
        tear,
      ]
    : sharedSurface
  return {
    positions: rest.slice(),
    dynamic: { velocities: rest.map(() => 0) },
    topology: {
      restPositions: rest,
      restNormals: rest.map(() => 0),
      tetrahedra: split ? [0, 1, 2, 3, 5, 7, 6, 4] : [0, 1, 2, 3, 0, 2, 1, 4],
      originalNodeIds: original,
      surface,
      failedFaces: split ? [0] : [],
      revision: split ? 1 : 0,
      initialVertexCount: 5,
    },
  }
}

void test('welded and split bipyramids retain analytic volume and mass, with two opposite crack caps', () => {
  const welded = analyzeRuntimeJelly(fixture())
  const split = analyzeRuntimeJelly(fixture(true))
  assert.equal(welded.mechanicalComponents.length, 1)
  assert.equal(split.mechanicalComponents.length, 2)
  assert.equal(welded.freeMass, 5)
  assert.equal(split.freeMass, 5)
  assert.equal(welded.restVolume, 1 / 3)
  assert.equal(split.restVolume, 1 / 3)
  assert.equal(split.capPairs, 1)
  for (const data of [welded, split]) {
    for (const property of [
      'missingBoundaryFaces',
      'extraSurfaceFaces',
      'orientationErrors',
      'invalidCapPairs',
      'openSurfaceEdges',
      'nonManifoldEdges',
      'windingErrors',
      'dyeMismatch',
    ])
      assert.equal(data[property], 0, property)
    assert.equal(data.volumeRatio, 1)
    assert.equal(data.freeDisplacementRms, 0)
  }
})

void test('material coordinates and corner provenance are checked against the intact reference', () => {
  const initial = fixture().topology
  const split = fixture(true)
  assert.equal(analyzeRuntimeJelly(split, initial).originalMaterialMismatch, 0)
  for (let id = 0; id < split.topology.originalNodeIds.length; id++) {
    if (split.topology.originalNodeIds[id] === 0)
      split.topology.restPositions[id * 4] += 0.03
  }
  split.topology.restNormals[0] = 0.5
  const changed = analyzeRuntimeJelly(split, initial)
  assert.equal(
    changed.dyeMismatch,
    0,
    'Within-snapshot copies alone miss coherent changes',
  )
  assert.equal(changed.originalMaterialMismatch, 0.5)
  split.topology.originalNodeIds[3] = 4
  assert.ok(analyzeRuntimeJelly(split, initial).materialCornerMismatches > 0)
})

void test('two tetrahedra sharing only one vertex remain mechanically joined despite disconnected faces', () => {
  const state = fixture()
  state.positions = [
    0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1, -1, 0, 0, 1, 0, -1, 0, 1, 0,
    0, -1, 1,
  ]
  state.topology.restPositions = state.positions.slice()
  state.topology.restNormals = state.positions.map(() => 0)
  state.topology.originalNodeIds = [0, 1, 2, 3, 4, 5, 6]
  state.topology.tetrahedra = [0, 1, 2, 3, 0, 5, 4, 6]
  state.topology.surface = []
  state.dynamic.velocities = state.positions.map(() => 0)
  const result = analyzeRuntimeJelly(state)
  assert.equal(result.faceComponents, 2)
  assert.equal(result.mechanicalComponents.length, 1)
  assert.equal(result.missingBoundaryFaces, 8)
})

void test('a point bridge to a pinned body cannot count as detached material', () => {
  const state = fixture()
  state.positions = [
    0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0,
    0, -1, 1,
  ]
  state.topology.restPositions = state.positions.slice()
  state.topology.restNormals = state.positions.map(() => 0)
  state.topology.originalNodeIds = [0, 1, 2, 3, 4, 5, 6]
  state.topology.tetrahedra = [0, 1, 2, 3, 0, 5, 4, 6]
  state.topology.surface = [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3],
    [0, 4, 5],
    [0, 5, 6],
    [0, 6, 4],
    [5, 4, 6],
  ].flatMap((face) => [...face, exterior])
  state.dynamic.velocities = state.positions.map(() => 0)
  const result = analyzeRuntimeJelly(state)
  assert.equal(result.faceComponents, 2)
  assert.equal(result.mechanicalComponents.length, 1)
  assert.equal(result.mechanicalComponents[0].pinned, 1)
  assert.equal(result.missingBoundaryFaces, 0)
  assert.equal(result.openSurfaceEdges, 0)
  assert.equal(result.windingErrors, 0)
  assert.equal(result.detachedRestVolumeFraction, 0)
})

void test('several real small fragments retain the same detached material floor as a larger chip', () => {
  // One pinned unit tetrahedron and two independent 0.08-sided tetrahedra.
  // Each small piece is below 0.1% of the solid; together they exceed 0.1%.
  const state = fixture()
  state.positions = []
  state.topology.tetrahedra = []
  state.topology.surface = []
  for (const [index, size] of [1, 0.08, 0.08].entries()) {
    const first = index * 4
    const x = index * 2
    state.positions.push(
      x,
      0,
      0,
      index === 0 ? 0 : 1,
      x + size,
      0,
      0,
      1,
      x,
      size,
      0,
      1,
      x,
      0,
      size,
      1,
    )
    state.topology.tetrahedra.push(first, first + 1, first + 2, first + 3)
    for (const face of [
      [0, 2, 1],
      [0, 1, 3],
      [0, 3, 2],
      [1, 2, 3],
    ])
      state.topology.surface.push(...face.map((node) => first + node), exterior)
  }
  state.topology.restPositions = state.positions.slice()
  state.topology.restNormals = state.positions.map(() => 0)
  state.topology.originalNodeIds = Array.from({ length: 12 }, (_, id) => id)
  state.topology.initialVertexCount = 12
  state.topology.restVolume = (1 + 2 * 0.08 ** 3) / 6
  state.dynamic.velocities = state.positions.map(() => 0)
  const result = analyzeRuntimeJelly(state, state.topology)
  const free = result.mechanicalComponents.filter(
    (component) => component.pinned === 0,
  )
  assert.equal(result.mechanicalComponents.length, 3)
  assert.equal(free.length, 2)
  assert.ok(
    free.every((component) => component.restVolume / result.restVolume < 0.001),
  )
  const expected = (2 * 0.08 ** 3) / (1 + 2 * 0.08 ** 3)
  assert.ok(Math.abs(result.detachedRestVolumeFraction - expected) < 1e-15)
  assert.ok(result.detachedRestVolumeFraction > 0.001)
  for (const property of [
    'missingBoundaryFaces',
    'extraSurfaceFaces',
    'orientationErrors',
    'openSurfaceEdges',
    'nonManifoldEdges',
    'windingErrors',
    'originalMaterialMismatch',
    'materialCornerMismatches',
  ])
    assert.equal(result[property], 0, property)
})

void test('a missing or inward-facing crack cap cannot pass the surface probe', () => {
  const missing = fixture(true)
  missing.topology.surface.splice(-4)
  const hole = analyzeRuntimeJelly(missing)
  assert.equal(hole.missingBoundaryFaces, 1)
  assert.equal(hole.openSurfaceEdges, 3)
  assert.equal(hole.invalidCapPairs, 1)
  const flipped = fixture(true)
  const s = flipped.topology.surface
  ;[s[s.length - 4], s[s.length - 3]] = [s[s.length - 3], s[s.length - 4]]
  const inward = analyzeRuntimeJelly(flipped)
  assert.equal(inward.orientationErrors, 1)
  assert.equal(inward.invalidCapPairs, 1)
  assert.equal(inward.windingErrors, 3)
})
