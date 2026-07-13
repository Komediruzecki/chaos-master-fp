# PR #24 Comprehensive Review — feat/flame-breeding

**Reviewed by**: 4 Claude Fable-5 agents (Security, Bugs & Logic, Code Quality, UI/UX)
**Files**: 35 changed, +10,759 / −2,014
**Date**: 2026-06-20

---

## Summary

| Severity | Count |
| -------- | ----- |
| CRITICAL | 5     |
| HIGH     | 27    |
| MEDIUM   | 37    |
| LOW      | 7     |

---

## CRITICAL (Must Fix Before Merge)

### 1. Elitism defeated by post-elite mutation

**File**: `packages/app/src/components/PopulationSimulator/PopulationSimulator.tsx:319-354`
**Category**: Bugs & Logic

Elite individuals are deep-cloned and prepended to children (line 323), but then `mutateFlame` is applied to **ALL** children including the elite clones (line 341-354). Elitism is meant to preserve the top individuals unchanged — mutating them causes genetic drift and defeats the purpose of elitism.

**Fix**: Skip the top `elite.length` entries in the mutation loop, or apply mutation only to non-elite children.

### 2. `diffFlames` returns 45% for identical empty-transform flames

**File**: `packages/app/src/flame/fdiff.ts:259-275`
**Category**: Bugs & Logic

When both flames have zero transforms, `totalTransforms = max(0,0) = 0`. The `totalTransforms > 0` guard means `transformSim` stays 0. Overall = `(0 * 0.55 + render.similarity * 0.45) * 100 = 45` for identical flames. They should score 100%.

**Fix**: When `totalTransforms === 0`, set `transformSim = 1`.

### 3. sRGB gamma-encoding not linearized before OkLab conversion

**File**: `packages/app/src/flame/fitness.ts:64-107`
**Category**: Bugs & Logic

`flameColorToSrgb` produces gamma-encoded sRGB, but `srgbToOklab` treats inputs as linear sRGB. No gamma expansion is applied, distorting `oklabDistance` — especially for dark colors. The `scoreColorSpread` heuristic (25% of composite fitness) is systematically inaccurate.

**Fix**: Apply sRGB gamma expansion (`c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4`) before passing to `srgbToOklab`.

### 4. Module-scoped `createSignal` — signals outside reactive root

**File**: `packages/app/src/flame/ancestry.ts:14-15`
**Category**: Code Quality & Architecture

```ts
const [ancestryDb, setAncestryDb] = createSignal<AncestryDb>({...})
```

`createSignal` is called at module scope in SolidJS, creating an orphaned owner context. Solid's reactivity system expects signals to be created within a reactive root (`createRoot`) or component. Module-scope signals may not dispose properly and can cause memory leaks or unexpected behavior.

**Fix**: Wrap in `createRoot(() => { ... })` or move inside a component/context provider.

### 5. FlameGallery Cell fallback creates invalid FlameDescriptor

**File**: `packages/app/src/components/FlameGallery/FlameGallery.tsx`
**Category**: Code Quality & Architecture

```ts
const flame = item.flame ?? ({} as unknown as FlameDescriptor)
```

A bare object cast as `FlameDescriptor` is not a valid flame — it has no transforms, no name, no render settings. This `as unknown as` pattern bypasses all type checking and will cause runtime errors downstream.

**Fix**: Either filter out items without flames, or provide a valid default FlameDescriptor with all required fields.

---

## HIGH (Should Fix Before Merge)

### Security & Data Safety

6. **Timer leak in `PopulationSimulator.applyFlame()`** — never calls `stop()` before dismissing, timers continue running on unmounted components
7. **`beforeunload` flush unreliable** — async `flushNow()` doesn't complete before page teardown; IndexedDB writes may be lost on tab close

### Code Quality & Architecture

8. **`CROSSOVER_LABELS` duplicated in 3 files** — `breedFlame.ts`, `FlameRandomizerCard.tsx`, and `BreedGallery.tsx` each have their own copy
9. **`PREVIEW_RESOLUTION` duplicated** — defined independently in multiple components
10. **`LooseTransform` type divergence** — `Transform` in `flameDescriptor.ts` and the shape used in breeding code have diverged
11. **Re-breed-on-config-change logic repeated 3×** — same pattern in BreedGallery, EvolutionChamber, and PopulationSimulator
12. **`AnyTransform = any`** — the entire breeding pipeline operates on `any`-typed transforms; a breaking schema change would not be caught by the type checker
13. **`breed+record` pattern duplicated** — every breeding component re-implements the same breed-then-record-to-ancestry flow
14. **`blendFlame` guard duplicated** — same null/empty check in multiple call sites
15. **No tests for `fitness.ts`** (266 lines, 0 tests) — all four heuristics and the composite scorer are untested
16. **No tests for `fdiff.ts`** (288 lines, 0 tests) — diff algorithm, greedy matching, render comparison all untested
17. **Missing tests for `smart` crossover** — the most complex crossover strategy has zero coverage
18. **`crossVariations` silently ignores duplicate variation types** — when a parent has multiple transforms with the same variation type, only the first's params are stored

### Bugs & Logic

19. **`uniformCrossover` balance constraint can deadlock** — when parent A has 10 transforms and parent B has 1, after selecting B's single label, all subsequent A labels are blocked; returns fewer than `count` transforms
20. **`crossVariations` duplicate type handling** — only first occurrence's params enter the map, later ones silently dropped

### UI/UX & Accessibility

21. **Missing `:focus-visible` on 5 component CSS files** — no visible focus indicators for keyboard navigation
22. **Touch targets below 44px** — close button 30px, randomize toggle 18px (WCAG 2.5.5 minimum is 44px)
23. **Edge labels at 0.55rem (~8.8px)** — below 12px minimum for readability
24. **No `prefers-reduced-motion` media query** — animations play regardless of user OS preference
25. **FlameGallery hardcoded colors** — not theme-aware, breaks in dark/light mode switching
26. **FlameGallery not dialog-based** — gallery opens inline without proper modal semantics
27. **AncestryTreeModal no responsive breakpoints** — layout breaks on mobile viewports

---

## MEDIUM (Fix Before Next Iteration)

### Security & Data Safety

28. Unhandled promise rejections in GA loop — a single failed generation silently kills the evolution
29. IndexedDB `open` has no timeout/`onblocked` handler — can hang indefinitely if another tab holds a connection
30. Module-scope event listeners (`beforeunload`, `visibilitychange`) never cleaned up
31. No IndexedDB quota validation — storage exhaustion fails silently mid-write
32. `JSON.stringify` in hot loop (every generation records to ancestry)

### Bugs & Logic

33. `alternateCrossover` NaN on empty source array — latent defect; currently guarded but fragile
34. `selectRoulette` fallback picks the worst individual — `shifted[shifted.length-1]` is lowest-scored, should be `shifted[0]`
35. `scoreTransformBalance` returns 0.5 for single transform — a single transform gets the same contribution as two perfectly balanced transforms
36. `randomizeAllColors` anchor spread is only ~60% of the valid color coordinate range

### Code Quality & Architecture

37. `createEffect` mutation cycle — effect writes to state that triggers re-run
38. Naming inconsistencies — `crossBreed` vs `breedFlames`, `metric` vs `score` vs `fitness`
39. `breedFlame.ts` is 832 lines — should be split into separate files per crossover strategy
40. Error handling gaps — GA loop swallows errors silently
41. CSS coupling — component styles depend on parent layout assumptions
42. `transformEntries` and `variationEntries` use `any` casts
43. Test quality issues — existing tests only check surface-level validity, not behavioral correctness
44. No integration tests for the breeding → ancestry → gallery data flow

### UI/UX & Accessibility

45. Modal `outline: none` without alternative focus indicator
46. No `aria-expanded` on collapsible sections
47. Font sizes below 12px in multiple places
48. AncestryTreeModal computes `diffFlames` at render time — expensive operation on every re-render
49. Missing focus indicators on interactive elements
50. No loading states for async operations
51. No empty states for galleries with no flames
52. No error boundaries around breeding components

---

## LOW (Nice to Have)

53. `diffFlames` greedy matching is not globally optimal (Hungarian algorithm would be optimal) — impact is visual diff quality only
54. Color coordinates clamped to [-0.4, 0.4] may not match renderer's actual valid range
55. `generateRandomFlame` sets colors twice (line 464 then overwritten at line 470)
56. No test for `count < 0` in `breedFlames`
57. Safe computed styles (XSS) — confirmed no dangerous inner HTML
58. No sanitization on user-provided flame names
59. No IndexedDB migration strategy for schema changes

---

## Test Coverage Gaps

| File            | Lines | Tests | Coverage Risk                                       |
| --------------- | ----- | ----- | --------------------------------------------------- |
| `fitness.ts`    | 266   | 0     | **NONE** — All heuristics untested                  |
| `fdiff.ts`      | 288   | 0     | **NONE** — Diff algorithm untested                  |
| `ancestry.ts`   | 318   | 0     | **NONE** — Signal graph + IndexedDB sync untested   |
| `ancestryDb.ts` | 129   | 0     | **NONE** — IndexedDB operations untested            |
| `breedFlame.ts` | 832   | 16    | **PARTIAL** — smart crossover, edge cases uncovered |
| `randomize.ts`  | ~500  | 0     | **NONE** — All randomization untested               |

---

## Action Items (Priority Order)

1. **Fix CRITICAL #1** — Stop mutating elite individuals (1-line fix)
2. **Fix CRITICAL #2** — Handle empty-transform edge case in `diffFlames` (2-line fix)
3. **Fix CRITICAL #3** — Add sRGB gamma expansion before OkLab conversion (~10 lines)
4. **Fix CRITICAL #4** — Wrap `createSignal` in `createRoot` or move to component
5. **Fix CRITICAL #5** — Replace `{} as unknown as FlameDescriptor` with proper default or filter
6. **Fix CI test** — `randomizeVariationParams` zero-default param bug
7. **Fix HIGH #6** — Add cleanup/stop for timers on component unmount
8. **Fix HIGH #7** — Use synchronous IndexedDB close or add timeout to beforeunload handler
9. **Deduplicate** — Extract shared constants (`CROSSOVER_LABELS`, `PREVIEW_RESOLUTION`, breed+record pattern)
10. **Add types** — Replace `AnyTransform = any` with proper generic or discriminated union
11. **Add tests** — Minimum: `fitness.ts` heuristics, `fdiff.ts` edge cases, `smart` crossover
12. **Accessibility pass** — Add `:focus-visible`, increase touch targets to 44px, add `prefers-reduced-motion`
13. **Fix roulette fallback** — Pick `shifted[0]` not `shifted[shifted.length-1]`
