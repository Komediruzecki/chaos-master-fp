# Analysis Summary: Timeline, Animation & Keyframe Issues

## Bugs & Issues Identified

| Category | Commit | File/Location | Issue | Severity | Impact |
|----------|--------|---------------|-------|----------|--------|
| **GPU Buffer** | bfda5ee | Flam3.tsx | IFS pipeline recreates WGSL shaders every frame despite memo | High | GPU overhead, frame drops |
| **GPU Buffer** | 6f36708 | Flam3.tsx | Manual buffer destroy calls causing use-after-free | High | Crash/wrong rendering |
| **GPU Buffer** | 39f0d80 | Flam3.tsx | outputTexturesReady counter not working correctly | High | Stale buffers after resize |
| **Timeline** | 01df3ca | timeline.ts | Keyframe lookup using array indexing with string keys | Medium | Lookup fails for many parameters |
| **Timeline** | 01df3ca | timeline.ts | Array keyframe values stored as strings | Medium | Color animation broken |
| **Timeline** | 8f47f91 | KeyframeEditor.tsx | TimelineState.togglePlay not using RAF lifecycle correctly | Medium | Playback timing issues |
| **Timeline** | 01df3ca | TimelineRuler.tsx | Reactive updates not propagating properly | Medium | UI not updating |
| **Timeline** | 01df3ca | timeline.ts | applyToFlame iterates via Object.keys() instead of tracks() | Medium | Misses keys, fails on numeric indices |
| **Timeline** | 94651b3 | timeline.ts | encoder variable never declared | High | All render passes fail silently |
| **Timeline** | 6a5fbe0 | App.tsx | Null timeline error on load when no keyframes exist | Low | Runtime error on init |
| **Timeline** | cdcfa81 | Flam3.tsx | TDZ error with shouldRenderFinalImage | High | Runtime crash on init |
| **CSS** | 005bc45 | KeyframeEditor.module.css | selector overflow in targetedParameter badge | Low | Truncated text in UI |
| **CSS** | 21f8b0e | AffineEditor.module.css | White screen after resize - missing transformGridRow | Medium | Broken layout |
| **CSS** | 21f8b0e | App.module.css | Void keywords breaking createEffect re-runs | Medium | Black screen after 1 frame |

## Architecture Issues

### 1. Timeline State Management
- Timeline state is created per component mount (App.tsx:263)
- Should be shared across siblings using context more effectively
- Keyframe lookup is O(n) instead of O(log n) with indices

### 2. Animation System
- RAF-based playback (`timeline.ts:632`) conflicts with the ticker in Flam3 (`Flam3.tsx:241`)
- No synchronization between timeline frame counter and renderer
- No frame skipping for fast-forward scenarios

### 3. Keyframe Interpolation
- Only basic easing curves available (linear, easeIn, easeOut, easeInOut, bounce, elastic)
- No support for variant-specific easing per keyframe
- No support for custom interpolation functions

### 4. GPU Pipeline Optimization
- IFS pipeline rebuild logic is complex and error-prone
- transformStructure memo doesn't account for all shader-affecting changes
- Buffer lifecycle management is fragile

### 5. UI/UX Issues
- Keyframe editor positioning is absolute, may get covered by canvas
- No visual indicators of interpolated values during playback
- Timeline ruler doesn't show time markers for different scales
- No preview of keyframe curves
