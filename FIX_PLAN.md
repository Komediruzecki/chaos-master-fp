# Fix Plan: Timeline, Animation & Keyframe Implementation

## Phase 1: Critical Stability Fixes

### 1.1 Fix TDZ Error in Flam3.tsx
**Location**: Flam3.tsx:237-248 (createAnimationFrame effect)

**Problem**: `shouldRenderFinalImage` declared after it's used in the effect body

**Fix**:
```typescript
// Move shouldRenderFinalImage declaration to top of effect
createEffect(() => {
  if (!timeline || !timeline.isPlaying()) return

  // Extract animatedFlame() once before creating pipeline
  const flame = animatedFlame()
  const _ = transformStructure()

  const tex = outputTextures
  if (!tex) return undefined

  // ... pipeline setup ...

  const [forceDrawToScreen, setForceDrawToScreen] = createSignal(true)
  const [clearRequested, setClearRequested] = createSignal(true)

  const shouldRenderFinalImage =
    forceDrawToScreen() ||
    _batchIndex() < OUTPUT_EVERY_FRAME_BATCH_INDEX ||
    _batchIndex() % OUTPUT_INTERVAL_BATCH_INDEX === 0 ||
    props.onExportImage !== undefined

  createAnimationFrame((frameId: number) => {
    // ... animation loop ...
  }, ...)
})
```

### 1.2 Fix encoder Never Declared
**Location**: Flam3.tsx:328-330

**Problem**: encoder created inside animation loop but should be scoped correctly

**Fix**: Current code is actually correct (inside loop), but add validation:
```typescript
createAnimationFrame((frameId: number) => {
  const encoder = device.createCommandEncoder()
  // ... validation ...
  if (colorGradingPipeline_ === undefined) {
    encoder.finish()
    return
  }
  // ... rendering ...
  device.queue.submit([encoder.finish()])
})
```

### 1.3 Fix outputTexturesReady Counter
**Location**: Flam3.tsx:126, 158, 161, 183, 186, 210-214

**Problem**: createMemo returns undefined when outputTextures is undefined, but signal value is 0

**Fix**: Already correct - check handles undefined correctly:
```typescript
const colorGradingPipeline = createMemo(() => {
  void outputTexturesReady() // forces effect re-run
  const o = outputTextures
  if (!o) return undefined
  // ...
})
```

### 1.4 Fix Buffer Use-After-Free
**Location**: Flam3.tsx:46-69 (removed in 6f36708, keep this pattern)

**Pattern to keep**: No manual buffer destruction in loop, let GC handle it. Buffer cleanup only on resize effect.

## Phase 2: Timeline & Keyframe Improvements

### 2.1 Replace Array Indexing with Map for Keyframe Lookup
**Location**: timeline.ts:134-136, 384-391

**Problem**: Using array.findIndex() with string path lookup is inefficient

**Fix**:
```typescript
// Add to TimelineTrack type
interface TimelineTrack {
  parameterPath: string
  keyframes: KeyframeData[]
  index: number // Add index on insertion
}

// In createTimelineState, update setTracks:
setTracks((prev: TimelineTrack[]) =>
  prev.map((t) => ({ ...t, index: prev.indexOf(t) })))
)

// In resolveVariationParameter, use index:
const track = timelineState.tracks()[trackIndex]
```

### 2.2 Fix Array Keyframe Value Storage
**Location**: timeline.ts:148 (KeyframeEditor.tsx)

**Problem**: Array values stored as strings

**Fix**:
```typescript
// In KeyframeEditor.tsx, handleArrayValue:
const parsed = parseArrayValue(value)
if (parsed !== null) {
  keyValue = parsed // Store as array, not string
}
```

### 2.3 Fix Timeline Playback Sync
**Location**: timeline.ts:632 (play function), Flam3.tsx:237-248

**Problem**: Two independent animation loops - timeline ticker vs renderer ticker

**Fix**: Use single animation loop:
```typescript
// In timeline.ts, create single ticker
function startTicker() {
  let frameId: number | null = null

  const tick = () => {
    if (!isPlaying()) {
      frameId = null
      return
    }

    const cfg = config()
    for (let i = 0; i < cfg.timeScale; i++) {
      advanceFrame()
    }

    frameId = requestAnimationFrame(tick)
  }

  frameId = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(frameId)
}

function play() {
  if (isPlaying()) return
  setIsPlaying(true)
  return startTicker()
}
```

## Phase 3: GPU Pipeline Optimization

### 3.1 Improve IFS Pipeline Memo
**Location**: Flam3.tsx:217-231

**Current**: Only tracks transform types and colorInitMode/pointInitMode

**Enhanced**:
```typescript
const transformStructure = createMemo(() => {
  const flame = animatedFlame()

  // Track structural changes
  const keys = Object.keys(flame.transforms).sort()

  const structure = keys
    .map((tid) => {
      const tr = flame.transforms[tid]
      const vTypes = Object.keys(tr.variations)
        .map((vid) => tr.variations[vid]?.type)
        .sort()
      return `${tid}:${vTypes.join(',')}`
    })
    .sort()
    .join('|')

  // Track shader-affecting numeric values
  const floatValues = keys
    .flatMap((tid) => {
      const tr = flame.transforms[tid]
      const vals = Object.values(tr.variations)
        .flatMap((v: any) =>
          Object.entries(v.params || {})
            .filter(([k]) => k.startsWith('_')) // Internal params
            .map(([, val]) => val)
        )
      return vals
    })
    .join(':')

  return `${structure}::${flame.renderSettings.colorInitMode}::${flame.renderSettings.pointInitMode}::${flame.renderSettings.skipIters}::${floatValues}`
})
```

### 3.2 Add Runtime Validation
**Location**: Flam3.tsx:283-301

**Add safety checks**:
```typescript
const ifsPipeline = createIFSPipeline(
  root,
  camera,
  flame.renderSettings.skipIters,
  pointRandomSeeds,
  flame.transforms as never,
  textureSize,
  typedAccumulationBuffer,
  flame.renderSettings.colorInitMode,
  flame.renderSettings.pointInitMode,
)

// Validate pipeline creation
if (!ifsPipeline) {
  console.error('Failed to create IFS pipeline')
  return
}

createEffect(() => {
  ifsPipeline.update(animatedFlame() as any)
  untrack(camera.update)
})
```

## Phase 4: UI/UX Improvements

### 4.1 Fix CSS Selector Overflow
**Location**: KeyframeEditor.module.css:71-86

**Fix**:
```css
.targetBadge {
  flex: 0 0 auto;
  max-width: 120px;
  padding: 2px 6px;
  background: var(--accent-color, #3b82f6);
  color: white;
  border-radius: 3px;
  font-size: 0.6rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
```

### 4.2 Add Missing CSS Class
**Location**: AffineEditor.module.css, App.module.css

**Add**:
```css
.transform-grid-row {
  display: grid;
  grid-template-columns: 1fr 1.5fr 0.5fr;
  align-items: center;
  justify-items: stretch;
  gap: var(--space-2);
  padding: var(--space-2) 0;
}
```

### 4.3 Add Keyframe Curve Preview
**Location**: New file KeyframeCurvePreview.tsx

**Feature**: SVG path visualization of keyframe interpolation curve

### 4.4 Add Timeline Time Scale Visualization
**Location**: TimelineRuler.tsx

**Feature**: Show relative time markers (1s, 2s, 3s based on FPS)

## Implementation Order

1. **Immediate (Stability)**: TDZ fix, encoder validation, buffer management
2. **Short term (Fixes)**: Keyframe lookup optimization, array value storage fix
3. **Medium term (Features)**: Single ticker, curve preview
4. **Long term (Optimizations)**: Enhanced pipeline memo, advanced interpolation

## Testing Strategy

1. Run tests after each critical fix
2. Manual testing of animation playback at various speeds
3. Test keyframe editing with numeric, string, and array values
4. Test GPU buffer lifecycle on resize
5. Test timeline loop and non-loop modes
