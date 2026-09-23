/**
 * What players are shown for the bundled examples: the Arena card, the Duel
 * judge and the Art Director's taste categories.
 *
 * The examples are the realistic fixtures here. They ship with the app, the
 * gallery's Examples tab loads them, and they look like every other flame the
 * app holds: generated transform and variation ids that differ from the
 * variation types, registered type names, 3D affines in the 3D layout. A
 * scorer that reads the wrong field shows up on them as the rows that moved.
 *
 * - Arena card: `calculateGroundedStats`, the school, HP, ATK, DEF and Power
 *   of a fighter card, then the dimension and stability of its strip.
 * - Duel: `powerCurveJudge` (the verdict and the four parts on the result
 *   card) and `scoreSheetJudge` (the HUD during the duel).
 * - Art Director: `extractFlameTasteFeatures().variationCategories`, what the
 *   taste profile learns category likes and dislikes from.
 *
 * The Arena's archetype opponents are pinned the same way: each archetype
 * generated from example1 (2D) and example30 (3D) with one seed, as the
 * opponent card shows it.
 */
import { describe, expect, it } from 'vitest'
import { powerCurveJudge, scoreSheetJudge } from '@/arcade/duelJudge'
import { extractFlameTasteFeatures } from '@/arcade/tasteStore'
import { calculateGroundedStats } from '@/flame/stats'
import { deepClone } from '@/utils/clone'
import { ARCHETYPE_IDS, generateArchetypeOpponent, } from '@/webmcp/tools/arenaArchetypes'
import { calculateFlameStats } from '@/webmcp/tools/scoreFlame'
import { examples } from './index'
import type { FlameDescriptor } from '../schema/flameSchema'

const NAME = 23

const entries = Object.entries(examples) as [string, FlameDescriptor][]
const examples2D = entries.filter(([, f]) => f.renderSettings.dimensions !== 3)
const examples3D = entries.filter(([, f]) => f.renderSettings.dimensions === 3)

const num = (value: number, width: number) => String(value).padStart(width)

/** name, school, HP, ATK, DEF, Power, dimension, stability */
function arenaRow([name, flame]: [string, FlameDescriptor]) {
  const g = calculateGroundedStats(flame)
  return [
    name.padEnd(NAME),
    g.school.padEnd(8),
    num(g.hp, 3),
    num(g.atk, 4),
    num(g.def, 4),
    num(g.powerLevel, 5),
    g.dimension.toFixed(2).padStart(6),
    g.stability.toFixed(2).padStart(6),
  ].join('')
}

/** name, verdict score, its complexity, chaos, symmetry and energy, HUD score */
function duelRow([name, flame]: [string, FlameDescriptor]) {
  const verdict = powerCurveJudge.judge(flame, flame)
  const part = (key: string) =>
    verdict.components.find((c) => c.key === key)?.player ?? NaN
  return [
    name.padEnd(NAME),
    num(verdict.playerScore, 5),
    part('complexity').toFixed(1).padStart(6),
    part('chaos').toFixed(1).padStart(6),
    part('symmetry').toFixed(1).padStart(6),
    part('energy').toFixed(1).padStart(7),
    num(scoreSheetJudge.judge(flame, flame).playerScore, 6),
  ].join('')
}

/** name, taste categories */
function tasteRow([name, flame]: [string, FlameDescriptor]) {
  const categories = extractFlameTasteFeatures(flame).variationCategories
  return `${name.padEnd(NAME)}${categories.length > 0 ? categories.join(' ') : '(none)'}`
}

function withExposure(flame: FlameDescriptor, exposure: number) {
  const copy = deepClone(flame)
  copy.renderSettings.exposure = exposure
  return copy
}

describe('the bundled examples, as players see them', () => {
  describe('Arena card', () => {
    it('2D', () => {
      // pins:arena2D
      expect(examples2D.map(arenaRow)).toEqual([
        'benchmark              Order   159  52  30 1413  2.00  0.59',
        'sierpinskiTriangle     Order   165  38  33 1233  1.58  0.65',
        'sierpinskiCarpet       Order   177  39  39 1297  1.89  0.77',
        'kochCurve              Order   177  35  39 1269  1.26  0.77',
        'barnsleyFern           Order   170  31  35 1112  1.84  0.70',
        'heighwayDragon         Order   151  36  26 1093  2.00  0.51',
        'cantorDust             Order   177  35  39 1269  1.26  0.77',
        'cliffordCsch2          Order   141  44  21 1165  2.00  0.41',
        'initExample            Order   130  16  15  664  0.98  0.30',
        'example1               Order   141  44  21 1157  2.00  0.41',
        'example2               Order   162  26  31 1024  1.12  0.62',
        'example3               Order   130  38  15  988  2.00  0.30',
        'example4               Order   162  30  31 1048  1.82  0.62',
        'example5               Order   156  38  28 1148  2.00  0.56',
        'example6               Order   162  30  31 1048  1.82  0.62',
        'example7               Order   162  30  31 1056  1.82  0.62',
        'example8               Order   165  44  33 1333  1.52  0.65',
        'example9               Order   164  41  32 1260  1.72  0.64',
        'example10              Order   173  36  37 1261  1.14  0.73',
        'example11              Order   168  41  34 1300  1.42  0.68',
        'example12              Order   168  43  34 1332  1.42  0.68',
        'example13              Order   172  39  36 1300  1.22  0.72',
        'example14              Order   168  41  34 1300  1.40  0.68',
        'example15              Order   172  39  36 1296  1.22  0.72',
        'example16              Order   172  39  36 1300  1.22  0.72',
        'example17              Order   169  38  35 1261  1.34  0.69',
        'example18              Order   172  38  36 1284  1.22  0.72',
        'example19              Order   169  39  35 1277  1.35  0.69',
        'example20              Order   171  40  36 1309  1.27  0.71',
        'example21              Order   168  48  34 1400  1.80  0.68',
        'example22              Order   172  46  36 1408  1.51  0.72',
        'example24              Order   169  39  35 1277  1.35  0.69',
        'example25              Order   171  40  36 1309  1.27  0.71',
        'example26              Order   133  39  33 1121  2.00  0.33',
        'example27              Order   158  42  29 1228  2.00  0.58',
        'example28              Order   159  38  30 1209  1.27  0.59',
        'example29              Order   140  39  45 1210  2.00  0.40',
        'example45              Order   168  39  34 1268  1.39  0.68',
        'linear1                Order   105  29   3  685  2.00  0.05',
        'invCircleEx1           Order   130  35  15  944  2.00  0.30',
        'invCircleEx2           Order   130  35  15  932  2.00  0.30',
        'invCircle2Ex1          Order   130  37  15  964  2.00  0.30',
        'neonJulianCosmos       Order   153  40  27 1173  2.00  0.53',
        'goldenApollonianGasket Order   165  38  33 1233  1.58  0.65',
        'cyberneticSwirl        Order   148  36  24 1064  2.00  0.48',
      ])
    })

    it('3D', () => {
      // pins:arena3D
      expect(examples3D.map(arenaRow)).toEqual([
        'sierpinskiTetrahedron  Order   151  31  26 1081  0.46  0.51',
        'mengerSponge           Order   154  29  27 1028  1.00  0.54',
        'initExample3D          Order   130  10  15  616  0.05  0.30',
        'example30              Order   148  32  24 1080  0.50  0.48',
        'example31              Order   149  37  25 1169  0.57  0.49',
        'example32              Order   150  36  25 1160  0.50  0.50',
        'example33              Order   160  31  30 1128  0.48  0.60',
        'example34              Order   146  32  23 1068  0.37  0.46',
        'example35              Order   148  41  24 1236  0.51  0.48',
        'example36              Order   152  36  26 1172  0.48  0.52',
        'example37              Order   154  38  27 1196  0.88  0.54',
        'example38              Order   157  36  28 1203  0.48  0.57',
        'example39              Order   151  41  26 1261  0.49  0.51',
        'example40              Order   153  38  27 1217  0.49  0.53',
        'example41              Order   144  36  22 1124  0.52  0.44',
        'example42              Order   156  42  28 1284  0.83  0.56',
        'example43              Order   155  39  28 1249  0.50  0.55',
        'example44              Order   153  37  27 1193  0.60  0.53',
        'example46              Order   131  36  16 1041  0.60  0.31',
      ])
    })
  })

  describe('Duel judge', () => {
    it('2D', () => {
      // pins:duel2D
      expect(examples2D.map(duelRow)).toEqual([
        'benchmark                394   5.9   5.7   0.0    4.2  2432',
        'sierpinskiTriangle       324   3.4   3.8   0.0    5.7  1515',
        'sierpinskiCarpet         430   5.8   5.7   0.0    5.7  2690',
        'kochCurve                361   4.1   4.4   0.0    5.9  1858',
        'barnsleyFern             381   4.1   4.4   0.0    6.7  2158',
        'heighwayDragon           281   2.6   2.9   0.0    5.7  1220',
        'cantorDust               356   4.1   4.4   0.0    5.7  1810',
        'cliffordCsch2            342   4.6   4.4   0.0    4.7  1660',
        'initExample              198   1.5   1.7   0.0    4.7   715',
        'example1                 342   4.6   4.4   0.0    4.7  1660',
        'example2                 250   2.6   2.7   0.0    4.7   976',
        'example3                 299   3.4   3.8   0.0    4.7  1305',
        'example4                 299   3.4   3.8   0.0    4.7  1305',
        'example5                 328   4.1   4.3   0.0    4.7  1534',
        'example6                 299   3.4   3.8   0.0    4.7  1305',
        'example7                 294   3.4   3.8   0.0    4.5  1279',
        'example8                 323   4.0   4.2   0.0    4.7  1535',
        'example9                 333   4.2   4.4   0.0    4.7  1599',
        'example10                339   4.2   4.6   0.0    4.7  1701',
        'example11                357   4.5   5.1   0.0    4.6  1919',
        'example12                352   4.4   4.9   0.0    4.7  1817',
        'example13                323   4.0   4.2   0.0    4.7  1528',
        'example14                326   4.0   4.3   0.0    4.7  1552',
        'example15                326   4.0   4.3   0.0    4.7  1546',
        'example16                336   4.2   4.5   0.0    4.7  1633',
        'example17                326   4.0   4.3   0.0    4.7  1546',
        'example18                329   4.0   4.4   0.0    4.7  1561',
        'example19                328   4.0   4.3   0.0    4.8  1549',
        'example20                328   4.0   4.1   0.0    5.0  1544',
        'example21                384   5.1   5.5   0.0    4.7  2242',
        'example22                376   5.0   5.3   0.0    4.7  2131',
        'example24                328   4.0   4.3   0.0    4.8  1549',
        'example25                328   4.0   4.1   0.0    5.0  1544',
        'example26                491   4.8   5.1   6.3    3.4  2303',
        'example27                304   4.0   3.8   0.0    4.4  1329',
        'example28                276   3.1   3.4   0.0    4.5  1142',
        'example29                552   6.0   5.7   6.7    3.7  2973',
        'example45                308   3.8   3.8   0.0    4.7  1340',
        'linear1                  328   4.1   3.5   0.0    5.6  1476',
        'invCircleEx1             271   2.6   2.9   0.0    5.3  1137',
        'invCircleEx2             422   5.8   5.7   0.0    5.4  2626',
        'invCircle2Ex1            444   6.1   5.7   0.0    6.0  2856',
        'neonJulianCosmos         369   4.0   3.8   0.0    7.0  2073',
        'goldenApollonianGasket   354   3.4   3.8   0.0    6.9  1965',
        'cyberneticSwirl          338   3.1   3.4   0.0    7.0  1871',
      ])
    })

    it('3D', () => {
      // pins:duel3D
      expect(examples3D.map(duelRow)).toEqual([
        'sierpinskiTetrahedron    358   4.1   4.4   0.0    5.8  1834',
        'mengerSponge             456   7.1   5.7   0.0    5.6  3094',
        'initExample3D            198   1.5   1.7   0.0    4.7   715',
        'example30                308   3.8   3.8   0.0    4.7  1345',
        'example31                308   3.8   3.8   0.0    4.7  1357',
        'example32               -560   3.8   3.8   0.0  -30.0   565',
        'example33               -982   3.8   4.0   0.0  -47.1   616',
        'example34                 76   3.8   4.0   0.0   -4.8   859',
        'example35                263   4.0   4.0   0.0    2.5  1167',
        'example36                233   4.0   4.0   0.0    1.3  1111',
        'example37                194   4.6   4.3   0.0   -1.1  1128',
        'example38                225   4.0   3.9   0.0    1.1  1030',
        'example39                205   4.0   4.0   0.0    0.2  1022',
        'example40                -28   4.0   3.9   0.0   -9.0   742',
        'example41                275   4.0   3.9   0.0    3.1  1178',
        'example42                211   4.7   4.3   0.0   -0.5  1193',
        'example43                210   4.0   3.9   0.0    0.5  1014',
        'example44                 25   4.6   4.6   0.0   -8.2  1082',
        'example46                324   4.6   4.4   0.0    4.0  1567',
      ])
    })

    // Exposure at the default vibrancy (0.5) and colour speed (0.4) of
    // example1: the energy part, the verdict and the HUD score around -3.5,
    // where the energy measurement reaches -4.
    it('energy near exposure -3.5', () => {
      const rows = [-4, -3.6, -3.55, -3.5, -3.45, -3.4, -1, 0, 0.25, 8].map(
        (exposure) => {
          const flame = withExposure(examples.example1, exposure)
          const verdict = powerCurveJudge.judge(flame, flame)
          const energy = calculateFlameStats(flame).metrics.energyIntensity
          const part = verdict.components.find((c) => c.key === 'energy')
          return [
            `exposure ${exposure}:`,
            `energy ${energy},`,
            `part ${part?.player},`,
            `verdict ${verdict.playerScore},`,
            `HUD ${scoreSheetJudge.judge(flame, flame).playerScore}`,
          ].join(' ')
        },
      )
      // pins:energyEdge
      expect(rows).toEqual([
        'exposure -4: energy -5, part 50, verdict 1474, HUD 640',
        'exposure -3.6: energy -4.2, part 210, verdict 5474, HUD 736',
        'exposure -3.55: energy -4.1, part 410, verdict 10474, HUD 748',
        'exposure -3.5: energy -4, part -Infinity, verdict -Infinity, HUD 760',
        'exposure -3.45: energy -3.9, part -390, verdict -9526, HUD 772',
        'exposure -3.4: energy -3.8, part -190, verdict -4526, HUD 784',
        'exposure -1: energy 1, part 2, verdict 274, HUD 1360',
        'exposure 0: energy 3, part 4.3, verdict 332, HUD 1600',
        'exposure 0.25: energy 3.5, part 4.7, verdict 342, HUD 1660',
        'exposure 8: energy 10, part 7.1, verdict 402, HUD 2440',
      ])
    })

    // Two players editing the same example: one swaps the type of a
    // variation, the other leaves it. [edited type, verdict, scores]
    it('a variation type swap in a duel', () => {
      const rows = ['juliaVar', 'swirlVar', 'linearVar', 'sphericalVar'].map(
        (type) => {
          const edited = deepClone(examples.example1)
          const first = Object.values(edited.transforms)[0]!
          Object.values(first.variations)[0]!.type = type
          const verdict = powerCurveJudge.judge(edited, examples.example1)
          return `${type}: ${verdict.winner}, ${verdict.playerScore} to ${verdict.rivalScore}`
        },
      )
      // pins:typeSwap
      expect(rows).toEqual([
        'juliaVar: draw, 342 to 342',
        'swirlVar: draw, 342 to 342',
        'linearVar: draw, 342 to 342',
        'sphericalVar: draw, 342 to 342',
      ])
    })
  })

  describe('Arena archetype opponents', () => {
    /** archetype, school, HP, ATK, DEF, Power, then the Duel verdict score */
    function opponentRow(base: FlameDescriptor) {
      return (id: (typeof ARCHETYPE_IDS)[number]) => {
        const fighter = generateArchetypeOpponent(base, id, 7)
        const g = fighter.groundedStats
        return [
          id.padEnd(NAME),
          g.school.padEnd(8),
          num(g.hp, 3),
          num(g.atk, 4),
          num(g.def, 4),
          num(g.powerLevel, 5),
          num(
            powerCurveJudge.judge(fighter.flame, fighter.flame).playerScore,
            6,
          ),
        ].join('')
      }
    }

    it('from example1 (2D)', () => {
      // pins:archetype2D
      expect(ARCHETYPE_IDS.map(opponentRow(examples.example1))).toEqual([
        'symmetry_monolith      Order   142  48  21 1232   342',
        'chaos_lord             Order   141  48  21 1229   342',
        'spiral_leviathan       Order   142  48  21 1236   342',
        'quantum_siren          Order   141  48  21 1233   342',
        'solar_seraph           Order   142  47  21 1220   342',
        'void_stalker           Order   141  48  21 1233   342',
      ])
    })

    it('from example30 (3D)', () => {
      // pins:archetype3D
      expect(ARCHETYPE_IDS.map(opponentRow(examples.example30))).toEqual([
        'symmetry_monolith      Order   148  37  24 1168   308',
        'chaos_lord             Order   149  40  25 1213   308',
        'spiral_leviathan       Order   148  38  24 1180   308',
        'quantum_siren          Order   148  39  24 1192   308',
        'solar_seraph           Order   148  38  24 1180   308',
        'void_stalker           Order   149  39  25 1201   308',
      ])
    })
  })

  describe('Art Director taste categories', () => {
    it('2D', () => {
      // pins:taste2D
      expect(examples2D.map(tasteRow)).toEqual([
        'benchmark              (none)',
        'sierpinskiTriangle     (none)',
        'sierpinskiCarpet       (none)',
        'kochCurve              (none)',
        'barnsleyFern           (none)',
        'heighwayDragon         (none)',
        'cantorDust             (none)',
        'cliffordCsch2          (none)',
        'initExample            (none)',
        'example1               (none)',
        'example2               (none)',
        'example3               (none)',
        'example4               (none)',
        'example5               (none)',
        'example6               (none)',
        'example7               (none)',
        'example8               (none)',
        'example9               (none)',
        'example10              (none)',
        'example11              (none)',
        'example12              (none)',
        'example13              (none)',
        'example14              (none)',
        'example15              (none)',
        'example16              (none)',
        'example17              (none)',
        'example18              (none)',
        'example19              (none)',
        'example20              (none)',
        'example21              (none)',
        'example22              (none)',
        'example24              (none)',
        'example25              (none)',
        'example26              (none)',
        'example27              (none)',
        'example28              (none)',
        'example29              (none)',
        'example45              (none)',
        'linear1                (none)',
        'invCircleEx1           (none)',
        'invCircleEx2           (none)',
        'invCircle2Ex1          (none)',
        'neonJulianCosmos       (none)',
        'goldenApollonianGasket (none)',
        'cyberneticSwirl        (none)',
      ])
    })

    it('3D', () => {
      // pins:taste3D
      expect(examples3D.map(tasteRow)).toEqual([
        'sierpinskiTetrahedron  (none)',
        'mengerSponge           (none)',
        'initExample3D          (none)',
        'example30              (none)',
        'example31              (none)',
        'example32              (none)',
        'example33              (none)',
        'example34              (none)',
        'example35              (none)',
        'example36              (none)',
        'example37              (none)',
        'example38              (none)',
        'example39              (none)',
        'example40              (none)',
        'example41              (none)',
        'example42              (none)',
        'example43              (none)',
        'example44              (none)',
        'example46              (none)',
      ])
    })
  })
})
