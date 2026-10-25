/** Candidate and reference geometry share one resting stage without joining their material sources. */
import { cleanup, render } from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CandidateSolidStage } from './CandidateSolidStage'
import type { GummyPalette } from '../GummyBear/gummyMaterial'
import type { RestPieceStageProps } from './RestPieceStage'

const fixture = vi.hoisted(() => ({
  props: undefined as RestPieceStageProps | undefined,
}))
vi.mock('./RestPieceStage', () => ({
  RestPieceStage(props: RestPieceStageProps) {
    fixture.props = props
    return null
  },
}))
afterEach(cleanup)
const source = {
  restPositions: new Float32Array([0, 0.2, 0, 1]),
  bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1.8, 0.5] },
  spacing: 0.04,
}
describe('candidate solid stage', () => {
  it('renders the actual candidate source and a distinct classic pawn on adjacent squares at equal scale', () => {
    render(() => (
      <CandidateSolidStage source={source} geometryKey="rook:1" mould="rook" />
    ))
    const scene = fixture.props!.scene
    expect(scene.meshes).toEqual({
      artStyle: 'classic',
      restSpacing: 0.08,
      moulds: ['rook', 'pawn'],
      restSources: { rook: source },
    })
    expect(scene.pieces).toEqual([
      {
        id: 0,
        mould: 'rook',
        position: [0.8, 0, 0.8],
        side: 0,
        scale: 0.9,
        palette: 'blue',
      },
      {
        id: 1,
        mould: 'pawn',
        position: [-0.8, 0, 0.8],
        side: 0,
        scale: 0.9,
        palette: 'amber',
      },
    ])
    expect(scene.inspectedMould).toBe('rook')
    expect(scene.framing.min[0]).toBeCloseTo(-1.538)
    expect(scene.framing.max[0]).toBeCloseTo(1.25)
    expect(scene.framing.max[1]).toBeCloseTo(2.385)
    expect(scene.framing.surfacePadding).toBeCloseTo(0.072)
  })
  it('changes presentation without changing geometry identity and updates bounds with the candidate', () => {
    const [palette, setPalette] = createSignal<GummyPalette>('blue')
    const [shape, setShape] = createSignal(source)
    const [key, setKey] = createSignal('bishop:1')
    render(() => (
      <CandidateSolidStage
        source={shape()}
        geometryKey={key()}
        mould="bishop"
        palette={palette()}
      />
    ))
    setPalette('berry')
    expect(fixture.props!.scene.key).toBe('bishop:1:bishop:0.04')
    expect(fixture.props!.scene.pieces[0]!.palette).toBe('berry')
    setShape({ ...source, bounds: { ...source.bounds, max: [0.5, 3, 0.5] } })
    setKey('bishop:2')
    expect(fixture.props!.scene.key).toBe('bishop:2:bishop:0.04')
    expect(fixture.props!.scene.framing.max[1]).toBeCloseTo(2.7)
  })
})
