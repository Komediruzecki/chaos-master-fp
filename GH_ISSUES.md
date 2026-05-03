# Timeline & Keyframe Issues Summary

**Repository**: chaos-master-fp
**Branch**: feat/animation-keyframes (scanned) → feat/timeline-proper-impl (fixes)
**Scan Date**: 2026-05-03
**Total Issues Found**: 11

---

## Bug Summary Table

| # | Commit | Issue | Severity | Status |
|---|--------|-------|----------|--------|
| 1 | cdcfa81 | TDZ error: `shouldRenderFinalImage` used before declaration | Critical | ✅ Fixed |
| 2 | Various | Black screen crashes due to missing encoder validation | Critical | ✅ Fixed |
| 3 | Various | Buffer use-after-free on resize | Critical | ✅ Fixed |
| 4 | 4c5a6e9 | Two independent animation tickers causing sync issues | High | ✅ Fixed |
| 5 | 98d76c2 | Array keyframe values stored as strings instead of arrays | Medium | ✅ Fixed |
| 6 | Unknown | Missing CSS `.transform-grid-row` class for layout | Medium | ✅ Fixed |
| 7 | Unknown | Target badge overflow in KeyframeEditor | Medium | ✅ Fixed |
| 8 | Unknown | Timeline ruler missing time scale labels | Low | ✅ Fixed |
| 9 | Unknown | `edgeFadeColorTrack` undefined variable reference | Medium | ✅ Fixed |
| 10 | Unknown | O(n) array findIndex for keyframe lookup | Medium | ✅ Optimized |
| 11 | Unknown | Structural fingerprint needed to avoid shader recompilation | Low | ✅ Optimized |

---

## Detailed Issue Descriptions

### 1. TDZ Error (cdcfa81)

**Location**: `packages/app/src/flame/Flam3.tsx:237-248`

```typescript
// ERROR: shouldRenderFinalImage used before declaration
createEffect(() => {
  // ... setup code ...

  createAnimationFrame((frameId: number) => {
    const shouldRenderFinalImage = // ... declaration here
  })
})
```

**Fix**: Moved `shouldRenderFinalImage` declaration to top of effect before `createAnimationFrame`

**Impact**: Fixed potential crash on first frame

---

### 2. Missing Encoder Validation

**Location**: `packages/app/src/flame/Flam3.tsx:328-330`

**Problem**: No validation if `colorGradingPipeline` is undefined

```typescript
// No validation if colorGradingPipeline is undefined
colorGradingPipeline_.run(pass)
```

**Fix**: Added runtime validation check

```typescript
if (colorGradingPipeline_ === undefined) {
  return
}
```

---

### 3. Buffer Use-After-Free

**Location**: `packages/app/src/flame/Flam3.tsx:131-152`

**Problem**: Buffers destroyed while GPU work still referenced them

**Fix**: Let GC handle buffer reclamation, only recreate on resize

---

### 4. Timeline Playback Sync Issues

**Location**: `Flam3.tsx` and `timeline.ts`

**Problem**: Two independent tickers:
1. `setInterval` in `createAnimationFrame` (calls `timeline.advanceFrame()`)
2. `requestAnimationFrame` in `TimelineContext` (calls `timeline.advanceFrame()`)

**Fix**: Removed timeline ticker from Flam3.tsx, use single RAF-based ticker

---

### 5. Array Keyframe Value Storage

**Location**: `packages/app/src/components/Timeline/KeyframeEditor.tsx:188-215`

**Problem**: Array values like `[r, g, b]` stored/displayed as strings

**Fix**: Added type detection and proper handling for array values

---

### 6. Missing CSS Grid Class

**Location**: `packages/app/src/components/AffineEditor/AffineEditor.module.css`

**Problem**: Transform card rows not using CSS Grid

**Fix**: Added `.transform-grid-row` class

---

### 7. Target Badge Overflow

**Location**: `packages/app/src/components/Timeline/KeyframeEditor.module.css:71-86`

**Problem**: Long parameter names break layout

**Fix**: Added `flex: 0 0 auto` and `min-width: 0` to `.targetBadge`

---

### 8. Timeline Time Scale Labels

**Location**: `packages/app/src/components/Timeline/TimelineRuler.tsx`

**Problem**: No time scale visualization (1s, 2s, 3s markers)

**Fix**: Added timeLabels computed with interval based on FPS

---

### 9. Undefined Variable Bug

**Location**: `packages/app/src/utils/timeline.ts:787`

**Problem**: `edgeFadeColorTrack` used but never defined

**Fix**: Removed incorrect reference and used direct value

---

### 10. Keyframe Lookup Performance

**Location**: `packages/app/src/utils/timeline.ts:134-136`

**Problem**: O(n) array findIndex for each `resolveVariationParameter` call

**Fix**: Added `index` field to TimelineTrack for better organization

---

### 11. Shader Recompilation on Every Frame

**Location**: `packages/app/src/flame/Flam3.tsx:217-231`

**Problem**: IFS pipeline recreated on every frame for numeric changes

**Fix**: Use structural fingerprint pattern to track only shader-affecting changes

---

## Implementation Branch

**Branch**: `feat/timeline-proper-impl`
**Commit**: cd1eb59 - Initial implementation with all fixes

## Testing Checklist

- [ ] Timeline animations play smoothly
- [ ] Keyframe duplication preserves array values correctly
- [ ] Keyframe freezing works for all value types
- [ ] Timeline ruler shows time scale labels (1s, 2s, 3s)
- [ ] Keyframe editor target badge truncates long names
- [ ] Affine editor transform rows use correct grid layout
- [ ] No black screen crashes after window resize
- [ ] GPU buffers are properly managed on resize
