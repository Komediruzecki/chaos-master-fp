# JWildfire Variation Audit

**Date**: 2026-06-02

**Total JWF concrete variations**: 876

| Status | Count |
|--------|-------|
| EXISTS (already ported) | 243 |
| NOT_VIABLE (3D, DC, simulation, etc.) | 543 |
| VIABLE (can convert, ≤8 params) | 90 |
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

## VIABLE Variations (≤8 params)

**Total viable**: 90

| # | Variation | Params | JWF File |
|---|-----------|--------|----------|
| 1 | acosech | 0 | AcosechFunc.java |
| 2 | acosh | 0 | AcoshFunc.java |
| 3 | acoth | 0 | AcothFunc.java |
| 4 | apocarpet | 0 | ApocarpetFunc.java |
| 5 | arch | 0 | ArchFunc.java |
| 6 | arcsech2 | 0 | Arcsech2Func.java |
| 7 | arcsinh | 0 | ArcsinhFunc.java |
| 8 | arctanh | 0 | ArctanhFunc.java |
| 9 | bMod | 6 | BModFunc.java |
| 10 | bSplit | 6 | BSplitFunc.java |
| 11 | bSwirl | 6 | BSwirlFunc.java |
| 12 | bilinear | 0 | BilinearFunc.java |
| 13 | cSin | 3 | CSinFunc.java |
| 14 | cos | 0 | CosFunc.java |
| 15 | cosh | 0 | CoshFunc.java |
| 16 | cot | 0 | CotFunc.java |
| 17 | coth | 0 | CothFunc.java |
| 18 | csc | 0 | CscFunc.java |
| 19 | csch | 0 | CschFunc.java |
| 20 | cylinder2 | 0 | Cylinder2Func.java |
| 21 | eDisc | 0 | EDiscFunc.java |
| 22 | ennepers | 0 | EnnepersFunc.java |
| 23 | extrude | 3 | ExtrudeFunc.java |
| 24 | flatten | 0 | FlattenFunc.java |
| 25 | flipCircle | 0 | FlipCircleFunc.java |
| 26 | flipY | 0 | FlipYFunc.java |
| 27 | gridout | 0 | GridoutFunc.java |
| 28 | hadamard | 0 | HadamardFunc.java |
| 29 | hexModulus | 3 | HexModulusFunc.java |
| 30 | holesq | 0 | HolesqFunc.java |
| 31 | hypershift | 6 | HypershiftFunc.java |
| 32 | inflateZ_1 | 0 | InflateZ_1Func.java |
| 33 | inflateZ_2 | 0 | InflateZ_2Func.java |
| 34 | inflateZ_3 | 0 | InflateZ_3Func.java |
| 35 | inflateZ_4 | 0 | InflateZ_4Func.java |
| 36 | inflateZ_5 | 0 | InflateZ_5Func.java |
| 37 | inflateZ_6 | 0 | InflateZ_6Func.java |
| 38 | invSquircular | 0 | InvSquircularFunc.java |
| 39 | invTree | 0 | InvTreeFunc.java |
| 40 | invpolar | 0 | InvpolarFunc.java |
| 41 | jacCn | 3 | JacCnFunc.java |
| 42 | jacDn | 3 | JacDnFunc.java |
| 43 | jacElk | 3 | JacElkFunc.java |
| 44 | jacSn | 3 | JacSnFunc.java |
| 45 | lace | 0 | LaceFunc.java |
| 46 | layeredSpiral | 3 | LayeredSpiralFunc.java |
| 47 | log | 0 | LogFunc.java |
| 48 | ortho | 6 | OrthoFunc.java |
| 49 | ovoid | 6 | OvoidFunc.java |
| 50 | panorama1 | 0 | Panorama1Func.java |
| 51 | panorama2 | 0 | Panorama2Func.java |
| 52 | petal | 0 | PetalFunc.java |
| 53 | plusRecip | 6 | PlusRecipFunc.java |
| 54 | polar2 | 0 | Polar2Func.java |
| 55 | postFlatten | 0 | PostFlattenFunc.java |
| 56 | postSpherical | 0 | PostSphericalFunc.java |
| 57 | preDisc | 0 | PreDiscFunc.java |
| 58 | preFlatten | 0 | PreFlattenFunc.java |
| 59 | preRotateY | 0 | PreRotateYFunc.java |
| 60 | preSpherical | 0 | PreSphericalFunc.java |
| 61 | preZScale | 0 | PreZScaleFunc.java |
| 62 | preZTranslate | 0 | PreZTranslateFunc.java |
| 63 | pressure_Wave | 6 | Pressure_WaveFunc.java |
| 64 | rays1 | 0 | Rays1Func.java |
| 65 | rays2 | 0 | Rays2Func.java |
| 66 | rays3 | 0 | Rays3Func.java |
| 67 | rippled | 0 | RippledFunc.java |
| 68 | roundSpher | 0 | RoundSpherFunc.java |
| 69 | sec | 0 | SecFunc.java |
| 70 | secant2 | 0 | Secant2Func.java |
| 71 | sech | 0 | SechFunc.java |
| 72 | sin | 0 | SinFunc.java |
| 73 | sinh | 0 | SinhFunc.java |
| 74 | spiralwing | 0 | SpiralwingFunc.java |
| 75 | sqrt_Acosech | 0 | Sqrt_AcosechFunc.java |
| 76 | sqrt_Acosh | 0 | Sqrt_AcoshFunc.java |
| 77 | sqrt_Acoth | 0 | Sqrt_AcothFunc.java |
| 78 | sqrt_Asech | 0 | Sqrt_AsechFunc.java |
| 79 | sqrt_Asinh | 0 | Sqrt_AsinhFunc.java |
| 80 | sqrt_Atanh | 0 | Sqrt_AtanhFunc.java |
| 81 | tan | 0 | TanFunc.java |
| 82 | tanCos | 0 | TanCosFunc.java |
| 83 | threePointIFS | 0 | ThreePointIFSFunc.java |
| 84 | tileHlp | 3 | TileHlpFunc.java |
| 85 | wDisc | 0 | WDiscFunc.java |
| 86 | whirligig | 3 | WhirligigFunc.java |
| 87 | zCone | 0 | ZConeFunc.java |
| 88 | zScale | 0 | ZScaleFunc.java |
| 89 | zTranslate | 0 | ZTranslateFunc.java |
| 90 | zTwister | 6 | ZTwisterFunc.java |

## Full CSV

See [jwf_variation_audit.csv](./jwf_variation_audit.csv) for the complete list of all 876 variations.
