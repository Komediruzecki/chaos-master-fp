/** Recover native maps in independent frames and prove bounded branching domains. */
import { describe, expect, it } from 'vitest'
import { validateFlame3D } from '../schema/flameSchema'
import { BLUE_BRANCH_PAWN_BOUNDS, BLUE_BRANCH_PAWN_POINT_LIGHTNESS, blueBranchBackbonePoint, blueBranchRootFrames, blueBranchStalkFrames, buildBlueBranchPawnFlame, DEFAULT_BLUE_BRANCH_PAWN_RECIPE, } from './blueBranchPawnFlame'
import { evaluateFlameFigurineTransform, sampleFlameFigurineCloud, } from './flameFigurineCloud'
import { isPointInsidePawnShellCavity } from './pawnBoardGeometry'
import type { FlameDescriptor3D, TransformId } from '../schema/flameSchema'
import type { PawnRecipe } from './pawnFlame'

type Point = readonly [number, number, number]
type Map = FlameDescriptor3D['transforms'][TransformId]
const B = BLUE_BRANCH_PAWN_BOUNDS
const CASES: Partial<PawnRecipe>[] = [
  {},
  { branchCount: 3, openness: 0, twist: -Math.PI },
  { branchCount: 8, openness: 1, twist: Math.PI },
]
const sub = (a: Point, b: Point): Point => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
]
const norm = (p: Point) => Math.hypot(...p)
const dot = (a: Point, b: Point) =>
  a.reduce((sum, value, n) => sum + value * b[n]!, 0)
const apply = (map: Map, p: Point): Point => {
  const m = map.postAffine
  return [
    m.a * p[0] + m.b * p[1] + m.c * p[2] + m.d,
    m.e * p[0] + m.f * p[1] + m.g * p[2] + m.h,
    m.i * p[0] + m.j * p[1] + m.k * p[2] + m.l,
  ]
}

function frames(twist: number) {
  return [...blueBranchStalkFrames(twist), ...blueBranchRootFrames(twist)]
}

function frame(group: string, twist = DEFAULT_BLUE_BRANCH_PAWN_RECIPE.twist) {
  const frond = frames(twist).find((f) => f.group === group)
  if (frond) {
    const c = Math.cos(frond.lean),
      s = Math.sin(frond.lean),
      cy = Math.cos(frond.yaw),
      sy = Math.sin(frond.yaw)
    return {
      centre: frond.origin,
      scale: frond.scales,
      axes: [
        [c * cy, -s, c * sy],
        [s * cy, c, s * sy],
        [-sy, 0, cy],
      ] as Point[],
    }
  }
  return {
    centre: [
      0,
      group === 'blue_head' ? B.headCentre : B.footHeight / 2,
      0,
    ] as Point,
    scale:
      group === 'blue_head'
        ? ([B.headRadius, B.headRadius, B.headRadius] as Point)
        : ([B.footRadius, B.footHeight / 2, B.footRadius] as Point),
    axes: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as Point[],
  }
}

function localMap(map: Map, twist = DEFAULT_BLUE_BRANCH_PAWN_RECIPE.twist) {
  const spec = frame(map.walkGroup!, twist)
  const world = (p: Point): Point =>
    [0, 1, 2].map(
      (axis) =>
        spec.centre[axis]! +
        p.reduce(
          (sum, value, n) =>
            sum + value * spec.scale[n]! * spec.axes[n]![axis]!,
          0,
        ),
    ) as unknown as Point
  const local = (p: Point): Point =>
    spec.axes.map(
      (axis, n) => dot(sub(p, spec.centre), axis) / spec.scale[n]!,
    ) as unknown as Point
  const offset = local(apply(map, spec.centre))
  const axes: Point[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  const columns = axes.map((axis) =>
    sub(local(apply(map, world(axis))), offset),
  )
  return { offset, columns, spec, world, local }
}

function gramBound(columns: Point[]) {
  const gram = columns.map((a) => columns.map((b) => dot(a, b)))
  return Math.sqrt(
    Math.max(
      ...gram.map((row) =>
        row.reduce((sum, value) => sum + Math.abs(value), 0),
      ),
    ),
  )
}
const BOX: Point[] = [-1, 1].flatMap((x) =>
  [0, 1].flatMap((y) => [-0.3, 0.3].map((z) => [x, y, z] as Point)),
)
const STALK_BOX: Point[] = [-1, 1].flatMap((x) =>
  [0, 1].flatMap((y) => [-0.5, 0.5].map((z) => [x, y, z] as Point)),
)

describe('blue branching glass core', () => {
  it('keeps native affine groups, normalized mass and colour-independent geometry', () => {
    const light = validateFlame3D(buildBlueBranchPawnFlame('light'))
    const dark = validateFlame3D(buildBlueBranchPawnFlame({ side: 'dark' }))
    expect(
      new Set(Object.values(light.transforms).map((m) => m.walkGroup)).size,
    ).toBe(9)
    expect(Object.keys(light.transforms).length).toBeLessThanOrEqual(128)
    expect(
      Object.values(light.transforms).reduce(
        (sum, m) => sum + m.probability,
        0,
      ),
    ).toBeCloseTo(1, 12)
    for (const [id, map] of Object.entries(light.transforms)) {
      expect(Object.values(map.variations).map((v) => v.type)).toEqual([
        'linear3D',
      ])
      expect(map.postAffine).toEqual(
        dark.transforms[id as TransformId]!.postAffine,
      )
      expect(map.probability).toBe(
        dark.transforms[id as TransformId]!.probability,
      )
    }
    expect(
      buildBlueBranchPawnFlame({
        branchCount: Infinity,
        openness: NaN,
        twist: NaN,
      }),
    ).toEqual(buildBlueBranchPawnFlame())
    light.transforms[Object.keys(light.transforms)[0] as TransformId]!.color.x =
      999
    expect(buildBlueBranchPawnFlame()).not.toEqual(light)
  })

  it.each(CASES)(
    'proves common component contraction metrics and invariant domains for %j',
    (recipe) => {
      const twist = recipe.twist ?? DEFAULT_BLUE_BRANCH_PAWN_RECIPE.twist
      const flame = validateFlame3D(buildBlueBranchPawnFlame(recipe))
      for (const map of Object.values(flame.transforms)) {
        const local = localMap(map, twist)
        const bound = gramBound(local.columns)
        expect(bound).toBeLessThan(0.97)
        if (
          map.walkGroup === 'blue_root_spine' ||
          map.walkGroup === 'blue_head'
        ) {
          expect(bound + norm(local.offset)).toBeLessThanOrEqual(1 + 1e-12)
        } else {
          const box = map.walkGroup!.startsWith('blue_stalk') ? STALK_BOX : BOX
          for (const corner of box) {
            const result = local.local(apply(map, local.world(corner)))
            expect(Math.abs(result[0])).toBeLessThanOrEqual(1 + 1e-12)
            expect(result[1]).toBeGreaterThanOrEqual(-1e-12)
            expect(result[1]).toBeLessThanOrEqual(1 + 1e-12)
            expect(Math.abs(result[2])).toBeLessThanOrEqual(
              (map.walkGroup!.startsWith('blue_stalk') ? 0.5 : 0.3) + 1e-12,
            )
          }
        }
      }
    },
  )

  it.each(CASES)(
    'proves complete frond boxes fit the actual polygonal glass cavity for %j',
    (recipe) => {
      const twist = recipe.twist ?? DEFAULT_BLUE_BRANCH_PAWN_RECIPE.twist
      const flame = validateFlame3D(buildBlueBranchPawnFlame(recipe))
      const levels = [
        0, 0.075, 0.115, 0.2, 0.24, 0.28, 0.32, 0.4, 0.62, 0.84, 0.99, 1.04,
        1.08, 1.12, 1.17, 1.2, 1.27, 1.36, 1.47, 1.58, 1.68, 1.77,
      ]
      for (const frond of frames(twist)) {
        const map = Object.values(flame.transforms).find(
          (m) => m.walkGroup === frond.group,
        )!
        const local = localMap(map, twist)
        const box = frond.group.startsWith('blue_stalk') ? STALK_BOX : BOX
        const vertices = box.map(local.world)
        for (let a = 0; a < box.length; a++)
          for (let b = a + 1; b < box.length; b++) {
            if (box[a]!.filter((value, n) => value !== box[b]![n]).length !== 1)
              continue
            const p = vertices[a]!,
              q = vertices[b]!
            for (const y of levels) {
              const t = (y - p[1]) / (q[1] - p[1])
              if (t >= 0 && t <= 1)
                vertices.push([
                  p[0] + t * (q[0] - p[0]),
                  y,
                  p[2] + t * (q[2] - p[2]),
                ])
            }
          }
        // Facet clearance is affine in XYZ within every profile band. Clipped-box
        // vertices therefore establish containment of the entire continuous box.
        for (const point of vertices)
          expect(
            isPointInsidePawnShellCavity(point, { radialSegments: 24 }),
          ).toBe(true)
      }
    },
  )

  it('fits the complete head sphere and root-spine ellipsoid inside the glass cavity', () => {
    for (let row = 0; row <= 400; row++) {
      const t = row / 400
      const sections = [
        {
          y: B.headCentre + B.headRadius * (2 * t - 1),
          radius: B.headRadius * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)),
        },
        {
          y: B.footHeight * t,
          radius: B.footRadius * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)),
        },
      ]
      for (const section of sections)
        for (let n = 0; n < 48; n++) {
          const angle = (n * 2 * Math.PI) / 48
          expect(
            isPointInsidePawnShellCavity(
              [
                Math.cos(angle) * section.radius,
                section.y,
                Math.sin(angle) * section.radius,
              ],
              { radialSegments: 24 },
            ),
          ).toBe(true)
        }
    }
  })

  it('has exact bowed-curve recurrences, real dyadic fork junctions and native sampler parity', () => {
    const flame = validateFlame3D(buildBlueBranchPawnFlame())
    for (const stalk of blueBranchStalkFrames(
      DEFAULT_BLUE_BRANCH_PAWN_RECIPE.twist,
    )) {
      const lower =
        flame.transforms[`${stalk.group}_lower_curve` as TransformId]!
      const upper =
        flame.transforms[`${stalk.group}_upper_curve` as TransformId]!
      const local = localMap(lower)
      for (let n = 0; n <= 32; n++) {
        const t = n / 32,
          point = local.world(blueBranchBackbonePoint(t))
        expect(
          norm(
            sub(
              local.local(apply(lower, point)),
              blueBranchBackbonePoint(t / 2),
            ),
          ),
        ).toBeLessThan(1e-12)
        expect(
          norm(
            sub(
              local.local(apply(upper, point)),
              blueBranchBackbonePoint((t + 1) / 2),
            ),
          ),
        ).toBeLessThan(1e-12)
        expect(
          norm(
            sub(
              evaluateFlameFigurineTransform(upper, point).position,
              apply(upper, point),
            ),
          ),
        ).toBeLessThan(3e-7)
      }
      const fork = flame.transforms[`${stalk.group}_fork_1` as TransformId]!
      expect(
        norm(
          sub(
            local.local(apply(fork, stalk.origin)),
            blueBranchBackbonePoint(0.5),
          ),
        ),
      ).toBeLessThan(1e-12)
      let tip = apply(fork, local.world([0, 1, 0])),
        joint = apply(fork, stalk.origin)
      const initial = norm(sub(tip, joint))
      expect(initial).toBeGreaterThan(0.1)
      for (let level = 0; level < 4; level++) {
        expect(norm(sub(tip, joint))).toBeGreaterThan(0.00001)
        tip = apply(upper, tip)
        joint = apply(upper, joint)
      }
    }
  })

  it('has shared head branch junctions and open negative bays established by ball covers', () => {
    const flame = validateFlame3D(buildBlueBranchPawnFlame())
    const head = Object.entries(flame.transforms).filter(
      ([, map]) => map.walkGroup === 'blue_head',
    )
    const bottom: Point = [0, B.headCentre - B.headRadius, 0]
    const upper = flame.transforms['blue_head_upper_axis' as TransformId]!
    const localHead = head.map(([, map]) => localMap(map))
    for (const [id, map] of head.filter(([id]) => id.includes('branch'))) {
      expect(
        norm(
          sub(localMap(map).local(apply(map, bottom)), [
            0,
            localMap(map).offset[1] - localMap(map).columns[1]![1],
            0,
          ]),
        ),
      ).toBeLessThan(1e-12)
      expect(id).toContain('blue_head_branch')
    }
    let gaps = 0
    for (let n = 0; n < 360; n++) {
      const angle = (n * 2 * Math.PI) / 360,
        p: Point = [0.86 * Math.cos(angle), 0, 0.86 * Math.sin(angle)]
      const covered = localHead.some((map) => {
        const relative = sub(p, map.offset)
        const inverse = map.columns.map(
          (column) => dot(relative, column) / norm(column) ** 2,
        )
        return Math.hypot(...inverse) <= 1
      })
      if (!covered) gaps++
    }
    expect(gaps).toBeGreaterThan(72)
    expect(
      norm(
        sub(apply(upper, [0, B.headCentre + B.headRadius, 0]), [
          0,
          B.headCentre + B.headRadius,
          0,
        ]),
      ),
    ).toBeLessThan(1e-12)
  })

  it.each(CASES)(
    'bakes deterministic non-flat contained multicolour points for %j',
    (recipe) => {
      const flame = buildBlueBranchPawnFlame(recipe)
      const cloud = sampleFlameFigurineCloud(flame, {
        count: 18000,
        seed: 91283,
        burnIn: 90,
        lightness: BLUE_BRANCH_PAWN_POINT_LIGHTNESS,
      })
      expect(cloud.points).toEqual(
        sampleFlameFigurineCloud(flame, {
          count: 18000,
          seed: 91283,
          burnIn: 90,
          lightness: BLUE_BRANCH_PAWN_POINT_LIGHTNESS,
        }).points,
      )
      expect(cloud.bounds.max[1] - cloud.bounds.min[1]).toBeGreaterThan(1.6)
      expect(cloud.bounds.max[0] - cloud.bounds.min[0]).toBeGreaterThan(0.45)
      expect(cloud.bounds.max[2] - cloud.bounds.min[2]).toBeGreaterThan(0.45)
      const colours = new Set<string>()
      for (let n = 0; n < cloud.count; n++) {
        const p: Point = [
          cloud.points[n * 4]!,
          cloud.points[n * 4 + 1]!,
          cloud.points[n * 4 + 2]!,
        ]
        expect(isPointInsidePawnShellCavity(p, { radialSegments: 24 })).toBe(
          true,
        )
        expect(cloud.colors[n * 4 + 3]).toBe(1)
        colours.add(
          `${Math.round(cloud.colorCoordinates[n * 2]! * 50)},${Math.round(cloud.colorCoordinates[n * 2 + 1]! * 50)}`,
        )
      }
      expect(colours.size).toBeGreaterThan(16)
    },
  )
})
