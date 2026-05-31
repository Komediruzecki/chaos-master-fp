# Flame Variations — Implementation Summary

## Current State

**Total variations:** 176 files across 6 categories (108 parametric general, 68 others)

### By Category

| Category | Parametric | Simple | Total |
|----------|-----------|--------|-------|
| `general` | 108 | 66 (48 inline + 18 standalone) | 174 |
| `blur` | 7 | 0 | 7 |
| `cut` | 3 | 0 | 3 |
| `dc` | 1 | 0 | 1 |
| `post` | 32 | 2 | 34 |
| `pre` | 0 | 2 | 2 |
| `synth` | 1 | 0 | 1 |
| **Total** | **152** | **70** | **222** |

> Note: 48 simple variations are defined inline in `simple/general/index.ts` (the core engine variations). 18 standalone `.ts` files add more. Total simple = 66.

### Core Engine Variations (inline in `simple/general/index.ts`)

waves, popcorn, rings, fan, linear, randomDisk, gaussian, sinusoidal, spherical, swirl, horseshoe, polar, handkerchief, heart, disc, spiral, hyperbolic, diamond, exVar, julia, bent, fisheye, eyefish, exponential, power, cosine, bubble, cylinder, noise, blurVar, archVar, tangentVar, squareVar, raysVar, bladeVar, secantVar, twintrianVar, crossVar, idiscVar, butterflyVar, unpolarVar, squarizeVar, sinusoidalVar, scryVar, tanhVar, twoFaceVar, pyramidVar, gridoutVar

---

## Conversion Recipe (Java → TypeGPU)

| JWildfire Java | TypeGPU WGSL |
|---------------|--------------|
| `pAffineTP.x`, `pAffineTP.y` | `pos.x`, `pos.y` |
| `pAmount` (multiplies result) | Handled by engine: `p += weight * result` |
| `pVarTP.x += value` | `newX = value` → `return vec2f(newX, newY)` |
| `Math.sin/cos/sqrt/atan2/abs/pow/floor` | `sin/cos/sqrt/atan2/abs/pow/floor` from `typegpu/std` |
| `Math.PI` | `PI.$` from `@/flame/constants` |
| `pContext.random()` | `random()` from `@/shaders/random` |
| `pContext.random(N)` | `floor(random() * N)` (0 to N-1) |
| `getPrecalcSqrt()` (x²+y² precalc) | `sqrt(pos.x * pos.x + pos.y * pos.y)` |
| `getPrecalcAtanYX()` | `atan2(pos.y, pos.x)` |
| `fmod(a, b)` | `a % b` (WGSL trunc-based, matches JWildfire) |
| `SMALL_EPSILON` / `EPS` | `EPS.$` from `@/flame/constants` |
| Parameters `P.param * pAmount` | `P.paramName` in impl (weight applied by engine) |
| `int` parameter | `i32` type from `typegpu/data` |
| `switch(x)` on int | `if/else if` chain with f32 comparisons |

### File Patterns

**Parametric** (`.tsx`):
```typescript
import { f32, struct, vec2f } from 'typegpu/data'
import { /* math fns */ } from 'typegpu/std'
import { RangeEditor } from '@/components/Sliders/ParametricEditors/RangeEditor'
import { editorProps } from '@/components/Sliders/ParametricEditors/types'
import { parametricVariation } from '../types'
// 1. Params struct + type + defaults
const NameParams = struct({ a: f32 })
type NameParams = Infer<typeof NameParams>
const NameDefaults: NameParams = { a: 1.0 }
// 2. Editor component
const NameEditor: EditorFor<NameParams> = (props) => (<>...</>)
// 3. Export
export const nameVar = parametricVariation('nameVar', NameParams, NameDefaults, NameEditor,
  (pos, _varInfo, P) => { 'use gpu'; /* impl */ return vec2f(x, y) }, 'general')
```

**Simple** (`.ts`):
```typescript
import { vec2f } from 'typegpu/data'
import { simpleVariation } from '../types'
export const nameVar = simpleVariation('nameVar', (pos, _varInfo) => {
  'use gpu'; /* impl */ return vec2f(x, y)
}, 'general')
```

---

## Engine Architecture

From `transformFunction.ts:77-84`:

1. `pre = transformAffine(preAffine, point.position)` — apply pre-affine transform
2. `p = vec2f(0)` — variation accumulator starts at zero
3. `p += weight * variation_result` — each variation result is multiplied by weight and added
4. `return transformAffine(postAffine, p) + post` — post-affine + post value

**Key insight:** The engine applies weight AFTER the variation returns. Variations should NOT multiply by `varInfo.weight` internally (the engine does it). If a variation formula references weight, it's for other purposes (e.g., non-linear weight scaling, angle modulation). `varInfo.weight` is available as `varInfo.weight` inside GPU functions.

`VariationInfo` struct: `{ weight: f32, affineCoefs: AffineParams }`

---

## Completed Batches

### Batch 1A — Organic/Nature (6 parametric) ✅
| Variation | Params | Description |
|-----------|--------|-------------|
| `sunflowerVar` | 1 (scale) | Fermat's spiral sunflower |
| `maurerRoseVar` | 2 (n, d) | Maurer rose curve |
| `seaShellVar` | 2 (turns, tightness) | Seashell spiral |
| `vogelVar` | 1 (scale) | Vogel spiral |
| `roseVar` | 2 (n, d) | Rhodonea rose curve |
| `treeVar` | 3 (branches, angle, scale) | Tree fractal |

### Batch 1B — Classical Attractors (4 parametric) ✅
| Variation | Params | Description |
|-----------|--------|-------------|
| `henonVar` | 2 (a, b) | Hénon map |
| `hopalongVar` | 3 (a, b, c) | Hopalong orbit |
| `loziVar` | 2 (a, b) | Lozi attractor |
| `gingerBreadVar` | 1 (scale) | Gingerbread man |
> Skipped: `lorenzVar` (3D, stateful ODE system)

### Batch 1C — L-Systems / Recursive (6 parametric) ✅
| Variation | Params | Description |
|-----------|--------|-------------|
| `dragonVar` | 1 (iterations) | Heighway dragon curve |
| `kochVar` | 1 (iterations) | Koch snowflake |
| `hilbertVar` | 1 (iterations) | Hilbert curve |
| `gosperVar` | 1 (iterations) | Gosper island |
| `rsquaresVar` | 2 (depth, scale) | Recursive squares |
| `sierCarpetVar` | 1 (iterations) | Sierpinski carpet |

### Batch 1D — Geometric / Hypertiling (8 parametric) ✅
| Variation | Params | Description |
|-----------|--------|-------------|
| `hypertileVar` | 2 (p, q) | Hyperbolic tiling |
| `hypertile2Var` | 2 (p, q) | Hyperbolic tiling variant 2 |
| `mobiusVar` | 4 (a, b, c, d) | Möbius transformation |
| `inversionVar` | 2 (radius, center) | Circle inversion |
| `projectiveVar` | 4 | Projective transformation |
| `squircularVar` | 1 (n) | Squircle mapping |
| `fresnelVar` | 1 (scale) | Fresnel integrals |
| `joukowskiVar` | 1 (thickness) | Joukowski airfoil |

### Batch 1E — Visual Specials (6 parametric) ✅
| Variation | Params | Description |
|-----------|--------|-------------|
| `devilWarpVar` | 2 (strength, mode) | Devil's warp |
| `yinYangVar` | 1 (scale) | Yin-Yang mapping |
| `pulseVar` | 2 (rate, amplitude) | Pulsing distortion |
| `woggleVar` | 3 (a, b, c) | Woggle distortion |
| `butterflyFayVar` | 4 (a, b, c, d) | Butterfly curve (Fay) |
| `sTwinVar` | 3 (a, b, c) | Twin variation |
> Completed: 6 of 6 planned (ducksVar, curliecueVar, harmonographVar, glitchVar replaced with implemented alternatives)

### Batch 1F/G/H — Later Batch Conversions (10) ✅
| Variation | Type | Params | Description |
|-----------|------|--------|-------------|
| `cardioidVar` | parametric | 1 (a) | Cardioid curve distortion |
| `collideoscopeVar` | parametric | 2 (a, num) | Mirror-based angular distortion |
| `epispiralVar` | parametric | 3 (n, thickness, holes) | Epispiral curve with dithering |
| `holeVar` | parametric | 2 (a, inside) | Circular hole with power function |
| `hole2Var` | parametric | 6 (a,b,c,d,inside,shape) | Multi-shape hole variant (10 shapes) |
| `superShapeVar` | parametric | 6 (rnd,m,n1,n2,n3,holes) | Superformula shape |
| `svenssonVar` | parametric | 4 (a,b,c,d) | Svensson attractor |
| `waffleVar` | parametric | 4 (slices,xthick,ythick,rot) | Random waffle tiling |
| `archVar` | simple | 0 | Arch curve (random-based) |
| `gridoutVar` | simple | 0 | Grid displacement |
> 8 parametric + 2 simple, all converted from JWildfire Java sources

---

## Earlier Variation Batches

### Blur Variations (7 parametric) ✅
`blurLinear`, `blurPixelizeVar`, `blurZoom`, `blurZoomVar`, `radialBlur`, `radialBlurVar`, `starBlurVar`

### Cut Variations (3 parametric) ✅
`cutApollonianVar`, `cutCircleDesignVar`, `cutFractalVar`

### DC Variations (1 parametric) ✅
`pixelFlowVar`

### Post Variations (32 parametric + 2 simple) ✅
`postAxisSymmetryWf`, `postBWraps2`, `postCircleCrop`, `postCrop`, `postCurl`, `postMirrorWf`, `postPointSymmetryWf`, `symBandG1`–`symBandG7`, `symNetG1`–`symNetG17`, `postSpherical`, `postSpinZ`

### Pre Variations (2 simple) ✅
`preBlur`, `preDisc`

### Synthesizer (1 parametric) ✅
`synthVar`

### Gemini-Converted General Variations (51 parametric) ✅
`anamorphCylVar`, `asteriaVar`, `atan2SpiralsVar`, `augerVar`, `barycentroidVar`, `bent2Var`, `blockYVar`, `boarders2Var`, `boxfoldVar`, `bubble2Var`, `bulgeVar`, `bwrandsVar`, `camouflageVar`, `cell2Var`, `chaosCubesVar`, `checksVar`, `crobVar`, `csinVar`, `curlVar`, `ejuliaVar`, `escherVar`, `fan2`, `fluxVar`, `hyperbolicEllipseVar`, `invCircle`, `invCircle2`, `invEllipse`, `juliaN`, `juliaQVar`, `kaplanVar`, `lazySusanVar`, `linearTVar`, `lineVar`, `modulusVar`, `murl2Var`, `ngonVar`, `nPolarVar`, `octagonVar`, `onion2Var`, `onionVar`, `perlinNoiseVar`, `popcorn2Var`, `q_odeVar`, `rippleVar`, `scry2Var`, `sinusGridVar`, `spirographVar`, `splitsVar`, `squishVar`, `stripfitVar`, `tunnelVar`

### Simple Standalone Variations (18) ✅
`acosechVar`, `acoshVar`, `acothVar`, `apocarpetVar`, `apollonyVar`, `arcsech2Var`, `arcsinhVar`, `arctanhVar`, `bilinearVar`, `bubbleVar`, `chrysanthemumVar`, `cothVar`, `cschVar`, `cschqVar`, `ediscVar`, `ennepersVar`, `laceVar`, `petalVar`

---

## Verification

After each batch:
1. `pnpm check` (typecheck + lint + fmt) passes
2. All 115 existing tests pass
3. Commit and push to `feat/variation-categories` with `feat:` prefix

## Key References

- Complex parametric: `packages/app/src/flame/variations/parametric/general/hexesVar.tsx`
- Simple parametric: `packages/app/src/flame/variations/parametric/post/postCircleCrop.tsx`
- Simple variation (standalone): `packages/app/src/flame/variations/simple/general/bubbleVar.ts`
- Core engine variations: `packages/app/src/flame/variations/simple/general/index.ts`
- Barrel exports: `packages/app/src/flame/variations/parametric/index.ts`
- Engine: `packages/app/src/flame/transformFunction.ts`
- Constants: `packages/app/src/flame/constants.ts`
- Types: `packages/app/src/flame/variations/simple/types.ts`
