/** Owns the elastic mesh, solver/renderer pair and transactional fracture replacement. */
import { onCleanup } from 'solid-js'
import { buildGummyJellyMesh } from '@/simulation/gummy/gummyJellyMesh'
import { buildGummyBearMesh } from '@/simulation/gummy/gummyMesh'
import { createGummySolver } from '@/simulation/gummy/gummySolver'
import { createGummySolverPreparationCache } from '@/simulation/gummy/gummySolverPreparation'
import { createGummyFractureRuntime } from './gummyFractureRuntime'
import { createGummyRenderer } from './gummyRenderer'
import { createGummyRenderResources } from './gummyRenderResources'
import { gummyRestBounds, holdGummyTearBody, layGummyBearBack, } from './gummyStudyMath'
import type { TgpuRoot } from 'typegpu'
import type { NativeGummyStudyProps } from './gummyStudyContracts'
import type { GummyMesh } from '@/simulation/gummy/gummyMesh'
import type { GummySolverDynamicState } from '@/simulation/gummy/gummySolver'

export function createGummyStudyResources(
  root: TgpuRoot,
  device: GPUDevice,
  context: GPUCanvasContext,
  canvasFormat: GPUTextureFormat,
  props: NativeGummyStudyProps,
) {
  const continuous = props.experiment === 'jelly'
  const tearProtocol = continuous && props.protocol === 'tear'
  const laid =
    props.experiment === 'crush' || (continuous && props.protocol === 'squeeze')
  const meshOptions: {
    fracture: 'none' | 'fine' | 'limbs'
    pinnedFeet: boolean
    pinHeight?: number
    spacing: number
  } = {
    fracture: continuous
      ? 'none'
      : props.experiment === 'crush'
        ? 'fine'
        : 'limbs',
    pinnedFeet: !laid,
    spacing: tearProtocol && props.geometry === 'fine' ? 0.1 : 0.14,
  }
  if (continuous && (props.protocol === 'stretch' || tearProtocol))
    meshOptions.pinHeight = 0.48
  const baseMesh = continuous
    ? buildGummyJellyMesh(meshOptions)
    : buildGummyBearMesh(meshOptions)
  const bodyFixture = tearProtocol
    ? holdGummyTearBody(baseMesh.positions)
    : undefined
  const initialMesh = bodyFixture
    ? { ...baseMesh, positions: bodyFixture.positions }
    : baseMesh
  let mesh = initialMesh
  let regions = new Set(mesh.nodeRegions).size
  let solverMesh = laid
    ? { ...mesh, positions: layGummyBearBack(mesh.positions) }
    : mesh
  const restBounds = gummyRestBounds(solverMesh.positions)
  const materialModel: 'neo-hookean' | 'edge-volume' = continuous
    ? 'neo-hookean'
    : 'edge-volume'
  const preparationCache = createGummySolverPreparationCache()
  const renderResources = createGummyRenderResources(
    root,
    device,
    context,
    canvasFormat,
  )
  onCleanup(() => {
    renderResources.destroy()
  })

  function allocatePair(
    nextMesh: GummyMesh,
    snapshot?: GummySolverDynamicState,
    sourceNodes?: Uint32Array,
  ) {
    const posedMesh = laid
      ? { ...nextMesh, positions: layGummyBearBack(nextMesh.positions) }
      : nextMesh
    const nextSolver = createGummySolver(root, device, posedMesh, {
      materialModel,
      jellyIterations: 24,
      jellySubsteps: tearProtocol && props.geometry === 'fine' ? 2 : 1,
      preparationCache,
      sourceNodes,
    })
    try {
      if (snapshot) nextSolver.restoreDynamic(snapshot, sourceNodes)
      const nextRenderer = createGummyRenderer(
        root,
        device,
        context,
        canvasFormat,
        nextMesh,
        nextSolver,
        renderResources,
      )
      return { solver: nextSolver, renderer: nextRenderer }
    } catch (error) {
      nextSolver.destroy()
      throw error
    }
  }
  const initialPair = allocatePair(mesh)
  let { solver, renderer } = initialPair
  const fractureRuntime = tearProtocol
    ? createGummyFractureRuntime<GummySolverDynamicState, typeof initialPair>(
        mesh,
        initialPair,
        allocatePair,
        (pair, nextMesh) => {
          solver = pair.solver
          renderer = pair.renderer
          mesh = nextMesh
          regions = new Set(nextMesh.nodeRegions).size
          solverMesh = nextMesh
        },
      )
    : undefined
  return {
    continuous,
    tearProtocol,
    laid,
    meshOptions,
    restBounds,
    materialModel,
    bodyFixture,
    fractureRuntime,
    get solver() {
      return solver
    },
    get renderer() {
      return renderer
    },
    get mesh() {
      return mesh
    },
    get regions() {
      return regions
    },
    get solverMesh() {
      return solverMesh
    },
    destroy() {
      if (fractureRuntime) fractureRuntime.destroy()
      else {
        renderer.destroy()
        solver.destroy()
      }
    },
  }
}
export type GummyStudyResources = ReturnType<typeof createGummyStudyResources>
