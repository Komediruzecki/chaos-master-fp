/** The generated 3D component selector, native weights and share round-trip. */
import { describe, expect, it } from 'vitest'
import { decodeSharePayload, encodeSharePayload } from '@/utils/jsonQueryParam'
import { examples } from './examples'
import { buildIfsPipeline, resolveIfsWgsl } from './ifsPipelineWgsl.testUtils'
import { validateFlame } from './schema/flameSchema'
import { extractFlameUniforms3D } from './transformFunction3D'
import { walkGroupsOf, walkGroupsSignature } from './walkGroups'
import type { TransformId, TransformRecord } from './schema/flameSchema'

const HEAD_A = 'a' as TransformId
const HEAD_B = 'b' as TransformId
const FOOT = 'c' as TransformId

const source = Object.values(examples.example37.transforms)[0]!
const grouped: TransformRecord = {
  [HEAD_A]: { ...source, walkGroup: 'head', probability: 1 },
  [HEAD_B]: { ...source, walkGroup: 'head', probability: 3 },
  [FOOT]: { ...source, walkGroup: 'foot', probability: 6 },
}
const withoutGroups = (transforms: TransformRecord): TransformRecord =>
  Object.fromEntries(
    Object.entries(transforms).map(([id, transform]) => {
      const { walkGroup: _group, ...rest } = transform
      return [id, rest]
    }),
  )

/** Read just one resolved function, excluding dependencies emitted after it. */
function functionBody(wgsl: string, name: string) {
  const start = wgsl.indexOf(`fn ${name}(`)
  const open = wgsl.indexOf('{', start)
  let depth = 1
  for (let index = open + 1; index < wgsl.length; index++) {
    if (wgsl[index] === '{') depth++
    if (wgsl[index] === '}') depth--
    if (depth === 0) return wgsl.slice(start, index + 1)
  }
  throw new Error(`missing resolved function ${name}`)
}

describe('native 3D component kernel', () => {
  const wgsl = resolveIfsWgsl({ transforms: grouped, dims: 3 })

  it('assigns from the immutable walker index without touching iteration RNG', () => {
    const setter = functionBody(wgsl, 'walkGroupIndexHash')
    expect(setter).toContain('let seed = hash(pointIndex);')
    expect(setter).toContain('f32(seed >> 8u) / 16777216.0')
    expect(setter).not.toContain('random()')
    expect(setter).not.toContain('pointRandomSeeds')
    expect(wgsl).toContain('walkGroupIndexHash(pointIndex)')
  })

  it('samples only maps of the selected component with its local total', () => {
    const step = functionBody(wgsl, 'executeRandomFlame')
    expect(step).toContain('random() * walkGroupTotal')
    const head = step.slice(step.indexOf('case 0u:'), step.indexOf('case 1u:'))
    const foot = step.slice(step.indexOf('case 1u:'), step.indexOf('default:'))
    expect(head).toContain('let uniforms = flameUniforms.flamea;')
    expect(head).toContain('let uniforms = flameUniforms.flameb;')
    expect(head).not.toContain('flameUniforms.flamec')
    expect(foot).toContain('let uniforms = flameUniforms.flamec;')
    expect(foot).not.toContain('flameUniforms.flamea')
    expect(foot).not.toContain('flameUniforms.flameb')
  })

  it('leaves all-zero chains unchanged using an unassigned group sentinel', () => {
    expect(wgsl).toContain('walkGroup = 2u;')
    expect(wgsl).toContain('walkGroupTotal = 0.0;')
    expect(wgsl).toMatch(/default:\s*\{\s*\}\s*\}\s*return point;/)
    const zeros = Object.fromEntries(
      Object.entries(grouped).map(([id, transform]) => [
        id,
        { ...transform, probability: 0 },
      ]),
    )
    const pipeline = buildIfsPipeline({ transforms: zeros, dims: 3 })
    pipeline.update({ ...examples.example37, transforms: zeros })
    const uniforms = extractFlameUniforms3D({ transforms: zeros }, true)
    expect(Object.values(uniforms).map((value) => value.probability)).toEqual([
      0, 0, 0,
    ])
  })

  it('writes positive visible weights without changing legacy or Clash normalization', () => {
    const transforms = {
      ...grouped,
      [HEAD_A]: { ...grouped[HEAD_A]!, probability: -5 },
      [HEAD_B]: { ...grouped[HEAD_B]!, probability: 2 },
      [FOOT]: { ...grouped[FOOT]!, probability: 9, visible: false },
    }
    const pipeline = buildIfsPipeline({ transforms, dims: 3 })
    pipeline.update({ ...examples.example37, transforms })
    const written = pipeline.writes.find(
      (value) =>
        typeof value === 'object' && value !== null && 'flamea' in value,
    ) as ReturnType<typeof extractFlameUniforms3D>
    expect([
      written.flamea?.probability,
      written.flameb?.probability,
      written.flamec?.probability,
    ]).toEqual([0, 1, 0])
    const legacy = extractFlameUniforms3D({ transforms })
    expect(legacy.flamea?.probability).toBe(5 / 3)
    expect(legacy.flameb?.probability).toBe(-2 / 3)
  })

  it('preserves the existing Clash kernel when fighters carry component metadata', () => {
    const teams: TransformRecord = {
      [HEAD_A]: { ...grouped[HEAD_A]!, team: 'A' },
      [HEAD_B]: { ...grouped[HEAD_B]!, team: 'A' },
      [FOOT]: { ...grouped[FOOT]!, team: 'B' },
    }
    expect(resolveIfsWgsl({ transforms: teams, dims: 3 })).toBe(
      resolveIfsWgsl({ transforms: withoutGroups(teams), dims: 3 }),
    )
  })

  it('does not change the 2D shader or no-group cache key', () => {
    const flat = {
      [HEAD_A]: {
        ...Object.values(examples.example1.transforms)[0]!,
        walkGroup: 'head',
      },
    }
    expect(resolveIfsWgsl({ transforms: flat, dims: 2 })).toBe(
      resolveIfsWgsl({ transforms: withoutGroups(flat), dims: 2 }),
    )
    expect(walkGroupsSignature(walkGroupsOf(withoutGroups(grouped)))).toEqual(
      {},
    )
  })

  it('recompiles the partition when group assignments change with the same map IDs', () => {
    const regrouped = {
      ...grouped,
      [HEAD_B]: { ...grouped[HEAD_B]!, walkGroup: 'foot' },
    }
    expect(resolveIfsWgsl({ transforms: regrouped, dims: 3 })).not.toBe(wgsl)
  })

  it('preserves group identity through the editor share path', async () => {
    const flame = validateFlame({ ...examples.example37, transforms: grouped })
    const decoded = await decodeSharePayload(await encodeSharePayload(flame))
    expect(decoded.flame).toEqual(flame)
    expect(walkGroupsOf(decoded.flame.transforms)).toEqual(
      walkGroupsOf(grouped),
    )
  })
})
