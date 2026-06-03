# JWildfire Variation Audit

**Date**: 2026-06-03 (updated)

**Total JWF concrete variations**: 876

| Status | Count |
|--------|-------|
| EXISTS (already ported) | 304 |
| NOT_VIABLE (3D, DC, simulation, etc.) | 572 |
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
| 23 | extrude | 3 | ❌ NOT_VIABLE (Z-only) |
| 24 | flatten | 0 | ❌ NOT_VIABLE (Z-only) |
| 25 | flipCircle | 0 | ✅ CONVERTED |
| 26 | flipY | 0 | ✅ CONVERTED |
| 27 | gridout | 0 | ✅ CONVERTED |
| 28 | hadamard | 0 | ✅ EXISTS |
| 29 | hexModulus | 3 | ✅ EXISTS |
| 30 | holesq | 0 | ✅ EXISTS |
| 31 | hypershift | 6 | ✅ EXISTS |
| 32 | inflateZ_1 | 0 | ❌ NOT_VIABLE (Z-only) |
| 33 | inflateZ_2 | 0 | ❌ NOT_VIABLE (Z-only) |
| 34 | inflateZ_3 | 0 | ❌ NOT_VIABLE (Z-only) |
| 35 | inflateZ_4 | 0 | ❌ NOT_VIABLE (Z-only) |
| 36 | inflateZ_5 | 0 | ❌ NOT_VIABLE (Z-only) |
| 37 | inflateZ_6 | 0 | ❌ NOT_VIABLE (Z-only) |
| 38 | invSquircular | 0 | ✅ EXISTS |
| 39 | invTree | 0 | ✅ EXISTS |
| 40 | invpolar | 0 | ✅ EXISTS |
| 41 | jacCn | 3 | ❌ NOT_VIABLE (Jacobi elliptic) |
| 42 | jacDn | 3 | ❌ NOT_VIABLE (Jacobi elliptic) |
| 43 | jacElk | 3 | ❌ NOT_VIABLE (Jacobi elliptic) |
| 44 | jacSn | 3 | ❌ NOT_VIABLE (Jacobi elliptic) |
| 45 | lace | 0 | ✅ EXISTS |
| 46 | layeredSpiral | 3 | ✅ CONVERTED |
| 47 | log | 0 | ✅ EXISTS |
| 48 | ortho | 6 | ❌ NOT_VIABLE (too complex) |
| 49 | ovoid | 6 | ✅ CONVERTED |
| 50 | panorama1 | 0 | ✅ EXISTS |
| 51 | panorama2 | 0 | ✅ EXISTS |
| 52 | petal | 0 | ✅ EXISTS |
| 53 | plusRecip | 6 | ✅ EXISTS |
| 54 | polar2 | 0 | ✅ EXISTS |
| 55 | postFlatten | 0 | ✅ EXISTS |
| 56 | postSpherical | 0 | ✅ EXISTS (simple) |
| 57 | preDisc | 0 | ✅ EXISTS (simple) |
| 58 | preFlatten | 0 | ✅ EXISTS |
| 59 | preRotateY | 0 | ❌ NOT_VIABLE (3D rotation) |
| 60 | preSpherical | 0 | ✅ EXISTS (simple) |
| 61 | preZScale | 0 | ❌ NOT_VIABLE (Z-only) |
| 62 | preZTranslate | 0 | ❌ NOT_VIABLE (Z-only) |
| 63 | pressure_Wave | 6 | ✅ EXISTS |
| 64 | rays1 | 0 | ✅ EXISTS |
| 65 | rays2 | 0 | ✅ EXISTS |
| 66 | rays3 | 0 | ✅ EXISTS |
| 67 | rippled | 0 | ✅ EXISTS |
| 68 | roundSpher | 0 | ✅ CONVERTED |
| 69 | sec | 0 | ✅ EXISTS |
| 70 | secant2 | 0 | ✅ EXISTS |
| 71 | sech | 0 | ✅ EXISTS |
| 72 | sin | 0 | ✅ EXISTS |
| 73 | sinh | 0 | ✅ EXISTS |
| 74 | spiralwing | 0 | ✅ EXISTS |
| 75 | sqrt_Acosech | 0 | ❌ NOT_VIABLE (complex numbers) |
| 76 | sqrt_Acosh | 0 | ❌ NOT_VIABLE (complex numbers) |
| 77 | sqrt_Acoth | 0 | ❌ NOT_VIABLE (complex numbers) |
| 78 | sqrt_Asech | 0 | ❌ NOT_VIABLE (complex numbers) |
| 79 | sqrt_Asinh | 0 | ❌ NOT_VIABLE (complex numbers) |
| 80 | sqrt_Atanh | 0 | ❌ NOT_VIABLE (complex numbers) |
| 81 | tan | 0 | ✅ EXISTS |
| 82 | tanCos | 0 | ✅ EXISTS |
| 83 | threePointIFS | 0 | ✅ EXISTS |
| 84 | tileHlp | 3 | ✅ CONVERTED |
| 85 | wDisc | 0 | ✅ EXISTS |
| 86 | whirligig | 3 | ✅ EXISTS |
| 87 | zCone | 0 | ❌ NOT_VIABLE (Z-only) |
| 88 | zScale | 0 | ❌ NOT_VIABLE (Z-only) |
| 89 | zTranslate | 0 | ❌ NOT_VIABLE (Z-only) |
| 90 | zTwister | 6 | ❌ NOT_VIABLE (Z-only) |

### Resolution of 36 (2026-06-03)

**7 converted** (4 simple + 3 parametric):
- Simple: flipCircle, flipY, gridout, roundSpher
- Parametric: layeredSpiral (3), ovoid (6), tileHlp (3)

**29 not viable:**
- 16 Z-only: extrude, flatten, inflateZ_1-6, preRotateY, preZScale, preZTranslate, zCone, zScale, zTranslate, zTwister
- 6 complex numbers: sqrt_Acosech, sqrt_Acosh, sqrt_Acoth, sqrt_Asech, sqrt_Asinh, sqrt_Atanh
- 4 Jacobi elliptic: jacCn, jacDn, jacElk, jacSn
- 1 too complex: ortho

## Full CSV

See [jwf_variation_audit.csv](./jwf_variation_audit.csv) for the complete list of all 876 variations.
