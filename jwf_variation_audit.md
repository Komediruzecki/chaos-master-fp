# JWildfire Variation Audit

**Date**: 2026-06-03 (updated)

**Total JWF concrete variations**: 876

| Status | Count |
|--------|-------|
| EXISTS (already ported) | 297 |
| NOT_VIABLE (3D, DC, simulation, etc.) | 543 |
| VIABLE (can convert, ≤8 params) | 36 |
| **Total** | **876** |

## NOT_VIABLE Breakdown

| Reason | Count |
|--------|-------|
| init() | 186 |
| 3D | 169 |
| BASE_SHAPE | 159 |
| SIMULATION | 152 |
| DC | 101 |
| DC/Color | 72 |
| BLUR | 9 |

## VIABLE Variations — Status (2026-06-03)

**54 of 90 implemented** | **36 remaining**

| # | Variation | Params | Status |
|---|-----------|--------|--------|
| 1 | acosech | 0 | ✅ EXISTS |
| 2 | acosh | 0 | ✅ EXISTS |
| 3 | acoth | 0 | ✅ EXISTS |
| 4 | apocarpet | 0 | ✅ EXISTS |
| 5 | arch | 0 | ✅ EXISTS |
| 6 | arcsech2 | 0 | ✅ EXISTS |
| 7 | arcsinh | 0 | ✅ EXISTS |
| 8 | arctanh | 0 | ✅ EXISTS |
| 9 | bMod | 6 | ✅ EXISTS |
| 10 | bSplit | 6 | ✅ EXISTS |
| 11 | bSwirl | 6 | ✅ EXISTS |
| 12 | bilinear | 0 | ✅ EXISTS |
| 13 | cSin | 3 | ✅ EXISTS |
| 14 | cos | 0 | ✅ EXISTS |
| 15 | cosh | 0 | ✅ EXISTS |
| 16 | cot | 0 | ✅ EXISTS |
| 17 | coth | 0 | ✅ EXISTS |
| 18 | csc | 0 | ✅ EXISTS |
| 19 | csch | 0 | ✅ EXISTS |
| 20 | cylinder2 | 0 | ✅ EXISTS |
| 21 | eDisc | 0 | ✅ EXISTS |
| 22 | ennepers | 0 | ✅ EXISTS |
| 23 | extrude | 3 | ❌ MISSING |
| 24 | flatten | 0 | ❌ MISSING |
| 25 | flipCircle | 0 | ❌ MISSING |
| 26 | flipY | 0 | ❌ MISSING |
| 27 | gridout | 0 | ❌ MISSING |
| 28 | hadamard | 0 | ✅ EXISTS |
| 29 | hexModulus | 3 | ✅ EXISTS |
| 30 | holesq | 0 | ✅ EXISTS |
| 31 | hypershift | 6 | ✅ EXISTS |
| 32 | inflateZ_1 | 0 | ❌ MISSING |
| 33 | inflateZ_2 | 0 | ❌ MISSING |
| 34 | inflateZ_3 | 0 | ❌ MISSING |
| 35 | inflateZ_4 | 0 | ❌ MISSING |
| 36 | inflateZ_5 | 0 | ❌ MISSING |
| 37 | inflateZ_6 | 0 | ❌ MISSING |
| 38 | invSquircular | 0 | ✅ EXISTS |
| 39 | invTree | 0 | ✅ EXISTS |
| 40 | invpolar | 0 | ✅ EXISTS |
| 41 | jacCn | 3 | ❌ MISSING |
| 42 | jacDn | 3 | ❌ MISSING |
| 43 | jacElk | 3 | ❌ MISSING |
| 44 | jacSn | 3 | ❌ MISSING |
| 45 | lace | 0 | ✅ EXISTS |
| 46 | layeredSpiral | 3 | ❌ MISSING |
| 47 | log | 0 | ✅ EXISTS |
| 48 | ortho | 6 | ❌ MISSING |
| 49 | ovoid | 6 | ❌ MISSING |
| 50 | panorama1 | 0 | ✅ EXISTS |
| 51 | panorama2 | 0 | ✅ EXISTS |
| 52 | petal | 0 | ✅ EXISTS |
| 53 | plusRecip | 6 | ✅ EXISTS |
| 54 | polar2 | 0 | ✅ EXISTS |
| 55 | postFlatten | 0 | ✅ EXISTS |
| 56 | postSpherical | 0 | ✅ EXISTS (simple) |
| 57 | preDisc | 0 | ✅ EXISTS (simple) |
| 58 | preFlatten | 0 | ✅ EXISTS |
| 59 | preRotateY | 0 | ❌ MISSING |
| 60 | preSpherical | 0 | ✅ EXISTS (simple) |
| 61 | preZScale | 0 | ❌ MISSING |
| 62 | preZTranslate | 0 | ❌ MISSING |
| 63 | pressure_Wave | 6 | ✅ EXISTS |
| 64 | rays1 | 0 | ✅ EXISTS |
| 65 | rays2 | 0 | ✅ EXISTS |
| 66 | rays3 | 0 | ✅ EXISTS |
| 67 | rippled | 0 | ✅ EXISTS |
| 68 | roundSpher | 0 | ❌ MISSING |
| 69 | sec | 0 | ✅ EXISTS |
| 70 | secant2 | 0 | ✅ EXISTS |
| 71 | sech | 0 | ✅ EXISTS |
| 72 | sin | 0 | ✅ EXISTS |
| 73 | sinh | 0 | ✅ EXISTS |
| 74 | spiralwing | 0 | ✅ EXISTS |
| 75 | sqrt_Acosech | 0 | ❌ MISSING |
| 76 | sqrt_Acosh | 0 | ❌ MISSING |
| 77 | sqrt_Acoth | 0 | ❌ MISSING |
| 78 | sqrt_Asech | 0 | ❌ MISSING |
| 79 | sqrt_Asinh | 0 | ❌ MISSING |
| 80 | sqrt_Atanh | 0 | ❌ MISSING |
| 81 | tan | 0 | ✅ EXISTS |
| 82 | tanCos | 0 | ✅ EXISTS |
| 83 | threePointIFS | 0 | ✅ EXISTS |
| 84 | tileHlp | 3 | ❌ MISSING |
| 85 | wDisc | 0 | ✅ EXISTS |
| 86 | whirligig | 3 | ✅ EXISTS |
| 87 | zCone | 0 | ❌ MISSING |
| 88 | zScale | 0 | ❌ MISSING |
| 89 | zTranslate | 0 | ❌ MISSING |
| 90 | zTwister | 6 | ❌ MISSING |

### Remaining 36 by category

**Simple 0-param (14):**
flatten, flipCircle, flipY, gridout, inflateZ_1-6, preRotateY, preZScale, preZTranslate, roundSpher, sqrt_Acosech, sqrt_Acosh, sqrt_Acoth, sqrt_Asech, sqrt_Asinh, sqrt_Atanh, zCone, zScale, zTranslate

**Parametric (18):**
extrude (3), jacCn (3), jacDn (3), jacElk (3), jacSn (3), layeredSpiral (3), ortho (6), ovoid (6), tileHlp (3), zTwister (6)

## Full CSV

See [jwf_variation_audit.csv](./jwf_variation_audit.csv) for the complete list of all 876 variations.
