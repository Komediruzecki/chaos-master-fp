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
        'benchmark              Tide    159  52  37 1455  2.00  0.59',
        'sierpinskiTriangle     Order   165  33  33 1193  1.58  0.65',
        'sierpinskiCarpet       Order   177  34  39 1257  1.89  0.77',
        'kochCurve              Order   177  30  39 1229  1.26  0.77',
        'barnsleyFern           Order   170  26  35 1072  1.84  0.70',
        'heighwayDragon         Order   151  32  26 1061  2.00  0.51',
        'cantorDust             Order   177  30  39 1229  1.26  0.77',
        'cliffordCsch2          Order   141  44  21 1165  2.00  0.41',
        'initExample            Order   130  12  15  632  0.98  0.30',
        'example1               Order   141  42  21 1141  2.00  0.41',
        'example2               Crystal 162  26  39 1072  1.12  0.62',
        'example3               Void    130  36  19  996  2.00  0.30',
        'example4               Order   162  25  31 1008  1.82  0.62',
        'example5               Order   156  34  35 1158  2.00  0.56',
        'example6               Order   162  25  31 1008  1.82  0.62',
        'example7               Order   162  26  31 1024  1.82  0.62',
        'example8               Order   165  43  41 1373  1.52  0.65',
        'example9               Order   164  40  40 1300  1.72  0.64',
        'example10              Order   173  36  46 1315  1.14  0.73',
        'example11              Crystal 168  40  43 1346  1.42  0.68',
        'example12              Crystal 168  42  43 1378  1.42  0.68',
        'example13              Order   172  39  36 1300  1.22  0.72',
        'example14              Tide    168  41  34 1300  1.40  0.68',
        'example15              Order   172  38  36 1288  1.22  0.72',
        'example16              Crystal 172  39  45 1354  1.22  0.72',
        'example17              Order   169  38  35 1261  1.34  0.69',
        'example18              Order   172  38  45 1338  1.22  0.72',
        'example19              Order   169  38  43 1317  1.35  0.69',
        'example20              Order   171  40  36 1309  1.27  0.71',
        'example21              Order   168  47  43 1446  1.80  0.68',
        'example22              Order   172  45  36 1400  1.51  0.72',
        'example24              Order   169  38  43 1317  1.35  0.69',
        'example25              Order   171  40  36 1309  1.27  0.71',
        'example26              Order   133  35  33 1089  2.00  0.33',
        'example27              Void    158  42  29 1228  2.00  0.58',
        'example28              Tide    159  37  30 1201  1.27  0.59',
        'example29              Order   140  36  45 1186  2.00  0.40',
        'example45              Void    168  38  34 1260  1.39  0.68',
        'linear1                Order   105  24   3  645  2.00  0.05',
        'invCircleEx1           Order   130  35  15  944  2.00  0.30',
        'invCircleEx2           Order   130  34  15  924  2.00  0.30',
        'invCircle2Ex1          Order   130  35  15  948  2.00  0.30',
        'neonJulianCosmos       Crystal 153  40  33 1209  2.00  0.53',
        'goldenApollonianGasket Void    165  38  33 1233  1.58  0.65',
        'cyberneticSwirl        Vortex  148  34  24 1048  2.00  0.48',
      ])
    })

    it('3D', () => {
      // pins:arena3D
      expect(examples3D.map(arenaRow)).toEqual([
        'sierpinskiTetrahedron  Order   151  25  26 1033  0.46  0.51',
        'mengerSponge           Order   154  24  27  988  1.00  0.54',
        'initExample3D          Order   130   6  15  584  0.05  0.30',
        'example30              Crystal 148  31  30 1108  0.50  0.48',
        'example31              Vortex  149  36  31 1197  0.57  0.49',
        'example32              Order   150  36  31 1196  0.50  0.50',
        'example33              Crystal 160  30  38 1168  0.48  0.60',
        'example34              Crystal 146  31  29 1096  0.37  0.46',
        'example35              Vortex  148  41  30 1272  0.51  0.48',
        'example36              Order   152  35  33 1206  0.48  0.52',
        'example37              Vortex  154  37  34 1230  0.88  0.54',
        'example38              Vortex  157  36  28 1203  0.48  0.57',
        'example39              Order   151  41  32 1297  0.49  0.51',
        'example40              Vortex  153  38  33 1253  0.49  0.53',
        'example41              Tide    144  35  28 1152  0.52  0.44',
        'example42              Order   156  41  35 1318  0.83  0.56',
        'example43              Crystal 155  39  34 1285  0.50  0.55',
        'example44              Order   153  37  33 1229  0.60  0.53',
        'example46              Crystal 131  36  19 1059  0.60  0.31',
      ])
    })
  })

  describe('Duel judge', () => {
    it('2D', () => {
      // pins:duel2D
      expect(examples2D.map(duelRow)).toEqual([
        'benchmark                532   5.9   5.7   5.5    4.2  2792',
        'sierpinskiTriangle       217   3.4   0.0   0.0    5.7   840',
        'sierpinskiCarpet         270   5.8   0.0   0.0    5.7  1190',
        'kochCurve                238   4.1   0.0   0.0    5.9   958',
        'barnsleyFern             258   4.1   0.0   0.0    6.7  1258',
        'heighwayDragon           200   2.6   0.0   0.0    5.7   770',
        'cantorDust               233   4.1   0.0   0.0    5.7   910',
        'cliffordCsch2            342   4.6   4.4   0.0    4.7  1660',
        'initExample              151   1.5   0.0   0.0    4.7   490',
        'example1                 314   4.6   3.4   0.0    4.7  1345',
        'example2                 388   2.6   2.7   5.5    4.7  1345',
        'example3                 374   3.4   2.9   4.0    4.7  1280',
        'example4                 192   3.4   0.0   0.0    4.7   630',
        'example5                 324   4.1   1.3   3.2    4.7  1000',
        'example6                 192   3.4   0.0   0.0    4.7   630',
        'example7                 187   3.4   0.0   0.0    4.5   604',
        'example8                 412   4.0   3.8   4.0    4.7  1577',
        'example9                 419   4.2   3.9   4.0    4.7  1619',
        'example10                433   4.2   4.4   4.0    4.7  1811',
        'example11                488   4.5   4.7   5.7    4.6  2139',
        'example12                486   4.4   4.6   5.7    4.7  2082',
        'example13                320   4.0   4.1   0.0    4.7  1483',
        'example14                326   4.0   4.3   0.0    4.7  1552',
        'example15                309   4.0   3.7   0.0    4.7  1366',
        'example16                478   4.2   4.5   5.7    4.7  2033',
        'example17                326   4.0   4.3   0.0    4.7  1546',
        'example18                429   4.0   4.4   4.0    4.7  1761',
        'example19                374   4.0   3.6   2.6    4.8  1469',
        'example20                328   4.0   4.1   0.0    5.0  1544',
        'example21                523   5.1   5.4   5.7    4.7  2563',
        'example22                365   5.0   4.9   0.0    4.7  1906',
        'example24                374   4.0   3.6   2.6    4.8  1469',
        'example25                328   4.0   4.1   0.0    5.0  1544',
        'example26                404   4.8   2.0   6.3    3.4  1403',
        'example27                293   4.0   3.4   0.0    4.4  1239',
        'example28                262   3.1   2.9   0.0    4.5  1029',
        'example29                493   6.0   3.6   6.7    3.7  2125',
        'example45                296   3.8   3.4   0.0    4.7  1250',
        'linear1                  230   4.1   0.0   0.0    5.6   880',
        'invCircleEx1             271   2.6   2.9   0.0    5.3  1137',
        'invCircleEx2             422   5.8   5.7   0.0    5.4  2626',
        'invCircle2Ex1            444   6.1   5.7   0.0    6.0  2856',
        'neonJulianCosmos         461   4.0   3.5   4.0    7.0  2206',
        'goldenApollonianGasket   354   3.4   3.8   0.0    6.9  1965',
        'cyberneticSwirl          308   3.1   2.3   0.0    7.0  1646',
      ])
    })

    it('3D', () => {
      // pins:duel3D
      expect(examples3D.map(duelRow)).toEqual([
        'sierpinskiTetrahedron    358   4.1   4.4   0.0    5.8  1834',
        'mengerSponge             456   7.1   5.7   0.0    5.6  3094',
        'initExample3D            198   1.5   1.7   0.0    4.7   715',
        'example30                460   3.8   3.8   6.1    4.7  1805',
        'example31                395   3.8   3.8   3.5    4.7  1517',
        'example32               -480   3.8   3.8   3.2  -30.0   705',
        'example33               -857   3.8   4.0   5.0  -47.1   914',
        'example34                208   3.8   4.0   5.3   -4.8  1199',
        'example35                350   4.0   4.0   3.5    2.5  1327',
        'example36                328   4.0   4.0   3.8    1.3  1291',
        'example37                274   4.6   4.3   3.2   -1.1  1268',
        'example38                225   4.0   3.9   0.0    1.1  1030',
        'example39                293   4.0   4.0   3.5    0.2  1183',
        'example40                 17   4.0   3.9   1.8   -9.0   802',
        'example41                347   4.0   3.9   2.9    3.1  1298',
        'example42                256   4.7   4.3   1.8   -0.5  1253',
        'example43                342   4.0   3.9   5.3    0.5  1354',
        'example44                 90   4.6   4.6   2.6   -8.2  1182',
        'example46                434   4.6   4.4   4.4    4.0  1811',
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
        'exposure -4: energy -5, part 50, verdict 1446, HUD 325',
        'exposure -3.6: energy -4.2, part 210, verdict 5446, HUD 421',
        'exposure -3.55: energy -4.1, part 410, verdict 10446, HUD 433',
        'exposure -3.5: energy -4, part -Infinity, verdict -Infinity, HUD 445',
        'exposure -3.45: energy -3.9, part -390, verdict -9554, HUD 457',
        'exposure -3.4: energy -3.8, part -190, verdict -4554, HUD 469',
        'exposure -1: energy 1, part 2, verdict 246, HUD 1045',
        'exposure 0: energy 3, part 4.3, verdict 304, HUD 1285',
        'exposure 0.25: energy 3.5, part 4.7, verdict 314, HUD 1345',
        'exposure 8: energy 10, part 7.1, verdict 374, HUD 2125',
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
        'juliaVar: player, 436 to 314',
        'swirlVar: player, 336 to 314',
        'linearVar: draw, 314 to 314',
        'sphericalVar: player, 336 to 314',
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
        'symmetry_monolith      Order   142  46  26 1246   326',
        'chaos_lord             Order   141  46  21 1213   314',
        'spiral_leviathan       Order   142  47  21 1228   314',
        'quantum_siren          Order   141  47  21 1225   314',
        'solar_seraph           Order   142  45  21 1204   314',
        'void_stalker           Order   141  47  21 1225   314',
      ])
    })

    it('from example30 (3D)', () => {
      // pins:archetype3D
      expect(ARCHETYPE_IDS.map(opponentRow(examples.example30))).toEqual([
        'symmetry_monolith      Crystal 148  37  30 1204   458',
        'chaos_lord             Crystal 149  40  31 1249   435',
        'spiral_leviathan       Crystal 148  38  30 1216   435',
        'quantum_siren          Crystal 148  39  30 1228   435',
        'solar_seraph           Crystal 148  38  30 1216   450',
        'void_stalker           Crystal 149  39  31 1237   435',
      ])
    })
  })

  describe('Art Director taste categories', () => {
    it('2D', () => {
      // pins:taste2D
      expect(examples2D.map(tasteRow)).toEqual([
        'benchmark              general',
        'sierpinskiTriangle     general',
        'sierpinskiCarpet       general',
        'kochCurve              general',
        'barnsleyFern           general',
        'heighwayDragon         general',
        'cantorDust             general',
        'cliffordCsch2          general',
        'initExample            general',
        'example1               general',
        'example2               general',
        'example3               general',
        'example4               general',
        'example5               general',
        'example6               general',
        'example7               general',
        'example8               general',
        'example9               general',
        'example10              general',
        'example11              general',
        'example12              general',
        'example13              general',
        'example14              general',
        'example15              dc general',
        'example16              general',
        'example17              general',
        'example18              general',
        'example19              general',
        'example20              general',
        'example21              blur general',
        'example22              general',
        'example24              general',
        'example25              general',
        'example26              general',
        'example27              general',
        'example28              general',
        'example29              general',
        'example45              general',
        'linear1                general',
        'invCircleEx1           general',
        'invCircleEx2           general',
        'invCircle2Ex1          general',
        'neonJulianCosmos       general',
        'goldenApollonianGasket general',
        'cyberneticSwirl        general',
      ])
    })

    it('3D', () => {
      // pins:taste3D
      expect(examples3D.map(tasteRow)).toEqual([
        'sierpinskiTetrahedron  general',
        'mengerSponge           general',
        'initExample3D          general',
        'example30              general',
        'example31              general',
        'example32              general',
        'example33              general',
        'example34              general',
        'example35              general',
        'example36              general',
        'example37              blur general',
        'example38              general',
        'example39              general',
        'example40              general',
        'example41              general',
        'example42              general',
        'example43              general',
        'example44              general',
        'example46              blur general',
      ])
    })
  })
})
