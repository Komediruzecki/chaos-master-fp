# GH Issue Summary Table

## GitHub Issue Template

```markdown
# Timeline, Animation & Keyframe Issues

## Summary of Issues Found
Scanned 40 commits on feat/animation-keyframes branch. Found 11+ bugs across GPU buffers, timeline state, keyframe lookup, CSS, and architecture issues.

## Bug Summary Table

| Commit | Component | Type | Issue | Severity | Status |
|--------|-----------|------|-------|----------|--------|
| bfda5ee | Flam3.tsx | Performance | IFS pipeline recreates WGSL shaders every frame | High | ⚠️ Needs Fix |
| 6f36708 | Flam3.tsx | Stability | Manual buffer destroy causing use-after-free | High | ⚠️ Needs Fix |
| 39f0d80 | Flam3.tsx | Stability | outputTexturesReady counter not working correctly | High | ⚠️ Needs Fix |
| 94651b3 | timeline.ts | Critical | encoder variable never declared - render fails | High | ⚠️ Critical |
| cdcfa81 | Flam3.tsx | Stability | TDZ error with shouldRenderFinalImage | High | ⚠️ Critical |
| 01df3ca | timeline.ts | Timeline | Keyframe lookup using array indexing with string keys | Medium | ⚠️ Needs Fix |
| 01df3ca | timeline.ts | Timeline | Array keyframe values stored as strings | Medium | ⚠️ Needs Fix |
| 8f47f91 | KeyframeEditor.tsx | Timeline | togglePlay not using RAF lifecycle correctly | Medium | ⚠️ Needs Fix |
| 01df3ca | timeline.ts | Timeline | applyToFlame iterates via Object.keys() | Medium | ⚠️ Needs Fix |
| 21f8b0e | AffineEditor.module.css | UI | Missing transformGridRow CSS causing white screen | Medium | ⚠️ Needs Fix |
| 005bc45 | KeyframeEditor.module.css | UI | selector overflow in targetedParameter badge | Low | ℹ️ Minor |
| 6a5fbe0 | App.tsx | Timeline | Null timeline error on init when no keyframes exist | Low | ℹ️ Minor |

## Critical Issues (Must Fix)

1. **encoder never declared** (94651b3) - All render passes silently fail
2. **TDZ error** (cdcfa81) - Runtime crash on component mount
3. **Buffer use-after-free** (6f36708) - GPU crashes
4. **outputTexturesReady counter not working** (39f0d80) - Stale buffers

## Architecture Problems

1. Timeline state created per mount instead of shared
2. No synchronization between timeline ticker and renderer
3. Keyframe lookup O(n) instead of O(log n)
4. IFS pipeline rebuild logic overly complex and fragile

## CSS/Styling Issues

1. White screen after resize (missing CSS class)
2. Selector overflow in keyframe editor badge
3. Layout issues with transform grid
```
