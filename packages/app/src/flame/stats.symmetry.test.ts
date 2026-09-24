/**
 * The symmetry order `calculateGroundedStats` reads from a flame's `_sym__`
 * transforms, and the stats that follow from it (DEF through the symmetry
 * multiplier, and Power), on real flames with each writer's symmetry.
 *
 * Radiant Symmetry ships with a 2D D4 dihedral set; Spiral Galaxy is a 3D
 * flame without one. Each gets 4- and 6-fold sets from both writers, and the
 * command's flame is also saved and loaded again.
 */
import { describe, expect, it } from 'vitest'
import { examples } from '@/flame/examples'
import { calculateGroundedStats } from './stats'
import { applySymmetryToFlame } from './symmetry'
import { applySymmetry, reload, SOURCES, TYPES, workspace, } from './symmetryTestUtils'
import type { SymmetryType } from './symmetryDetection'
import type { Source } from './symmetryTestUtils'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

const FLAMES: { name: string; flame: FlameDescriptor }[] = [
  { name: 'Radiant Symmetry (2D)', flame: examples.example26 },
  { name: 'Spiral Galaxy (3D)', flame: examples.example37 },
]

function withSymmetry(
  flame: FlameDescriptor,
  type: SymmetryType,
  folds: number,
  source: Source,
): FlameDescriptor {
  if (source === 'symmetry.ts') return applySymmetryToFlame(flame, folds, type)
  const ws = workspace(flame)
  applySymmetry(ws.ctx, folds, type, 'add')
  return source === 'command' ? ws.flame() : reload(ws.flame())
}

function describeStats(flame: FlameDescriptor): string {
  const s = calculateGroundedStats(flame)
  return `order ${s.symmetryOrder}, DEF ${s.def}, Power ${s.powerLevel}`
}

describe('the symmetry order in the grounded stats', () => {
  it('pins it per flame, writer, type and fold count', () => {
    const rows: string[] = []
    for (const { name, flame } of FLAMES) {
      rows.push(`${name} as shipped: ${describeStats(flame)}`)
      for (const type of TYPES) {
        for (const folds of [4, 6]) {
          for (const source of SOURCES) {
            rows.push(
              `${name} ${type} ${folds} by ${source}: ${describeStats(withSymmetry(flame, type, folds, source))}`,
            )
          }
        }
      }
    }
    expect(rows).toEqual([
      'Radiant Symmetry (2D) as shipped: order 5, DEF 33, Power 1121',
      'Radiant Symmetry (2D) rotational 4 by symmetry.ts: order 4, DEF 29, Power 1093',
      'Radiant Symmetry (2D) rotational 4 by command: order 4, DEF 29, Power 1093',
      'Radiant Symmetry (2D) rotational 4 by command, reloaded: order 4, DEF 29, Power 1093',
      'Radiant Symmetry (2D) rotational 6 by symmetry.ts: order 6, DEF 36, Power 1116',
      'Radiant Symmetry (2D) rotational 6 by command: order 6, DEF 36, Power 1116',
      'Radiant Symmetry (2D) rotational 6 by command, reloaded: order 6, DEF 36, Power 1116',
      'Radiant Symmetry (2D) dihedral 4 by symmetry.ts: order 5, DEF 33, Power 1105',
      'Radiant Symmetry (2D) dihedral 4 by command: order 5, DEF 33, Power 1105',
      'Radiant Symmetry (2D) dihedral 4 by command, reloaded: order 5, DEF 33, Power 1105',
      'Radiant Symmetry (2D) dihedral 6 by symmetry.ts: order 7, DEF 40, Power 1120',
      'Radiant Symmetry (2D) dihedral 6 by command: order 7, DEF 40, Power 1120',
      'Radiant Symmetry (2D) dihedral 6 by command, reloaded: order 7, DEF 40, Power 1120',
      'Spiral Galaxy (3D) as shipped: order 1, DEF 27, Power 1196',
      'Spiral Galaxy (3D) rotational 4 by symmetry.ts: order 4, DEF 31, Power 1067',
      'Spiral Galaxy (3D) rotational 4 by command: order 4, DEF 31, Power 1067',
      'Spiral Galaxy (3D) rotational 4 by command, reloaded: order 4, DEF 31, Power 1067',
      'Spiral Galaxy (3D) rotational 6 by symmetry.ts: order 6, DEF 36, Power 1132',
      'Spiral Galaxy (3D) rotational 6 by command: order 6, DEF 36, Power 1132',
      'Spiral Galaxy (3D) rotational 6 by command, reloaded: order 6, DEF 36, Power 1132',
      'Spiral Galaxy (3D) dihedral 4 by symmetry.ts: order 5, DEF 35, Power 1067',
      'Spiral Galaxy (3D) dihedral 4 by command: order 5, DEF 35, Power 1067',
      'Spiral Galaxy (3D) dihedral 4 by command, reloaded: order 5, DEF 35, Power 1067',
      'Spiral Galaxy (3D) dihedral 6 by symmetry.ts: order 7, DEF 40, Power 1136',
      'Spiral Galaxy (3D) dihedral 6 by command: order 7, DEF 40, Power 1136',
      'Spiral Galaxy (3D) dihedral 6 by command, reloaded: order 7, DEF 40, Power 1136',
    ])
  })
})
