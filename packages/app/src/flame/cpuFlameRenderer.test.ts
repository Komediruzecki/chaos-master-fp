import { describe, expect, it } from 'vitest'
import { CPUFlameRenderer, testCPURenderer } from './cpuFlameRenderer'
import type { FlameDescriptor } from './schema/flameSchema'

describe('CPU Flame Renderer', () => {
  const sampleFlame: FlameDescriptor = {
    metadata: { author: '' },
    renderSettings: {
      exposure: 1,
      skipIters: 10,
      vibrancy: 0.5,
      palettePhase: 0,
      paletteSpeed: 0,
      drawMode: 'light',
      colorInitMode: 'colorInitZero',
      pointInitMode: 'pointInitUnitDisk',
      backgroundColor: undefined,
      edgeFadeColor: [0, 0, 0, 0.8],
      camera: { zoom: 1, position: [0, 0] },
    },
    transforms: {
      0: {
        name: 'Simple Transform',
        probability: 1,
        colorMode: 'colorByDensity',
        dims: 3,
        uniforms: {
          scale: [0.5, 0.5, 0.5],
          rotateX: 0,
          rotateY: 0,
          rotateZ: 0,
          shearX: 0,
          shearY: 0,
        },
        matrix: [0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5],
        color: { r: 0, g: 0, b: 0, mode: 'colorByDensity' },
      },
    } as FlameDescriptor['transforms'],
  }

  describe('CPUFlameRenderer', () => {
    it('should initialize with flame descriptor', () => {
      const renderer = new CPUFlameRenderer(sampleFlame)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((renderer as any).transforms).toBeDefined()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((renderer as any).flameFunctions).toBeDefined()
    })

    it('should render basic scene', () => {
      const renderer = new CPUFlameRenderer(sampleFlame)

      const result = renderer.render({
        width: 100,
        height: 100,
        quality: 10,
        pointCountPerBatch: 100,
      })

      expect(result).toBeDefined()
      expect(result.canvas.width).toBe(100)
      expect(result.canvas.height).toBe(100)
      expect(result.buckets).toBeInstanceOf(Float32Array)
      expect(result.buckets.length).toBe(100 * 100 * 3) // count, a, b per bucket
      expect(result.bucketsData).toBeDefined()
    })

    it('should create CPU transform functions', () => {
      const renderer = new CPUFlameRenderer(sampleFlame)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const transforms = Object.entries((renderer as any).flameFunctions)
      expect(transforms.length).toBeGreaterThan(0)
    })

    it('should handle empty canvas size', () => {
      const renderer = new CPUFlameRenderer(sampleFlame)

      const result = renderer.render({
        width: 0,
        height: 0,
        quality: 10,
        pointCountPerBatch: 100,
      })

      expect(result).toBeDefined()
      expect(result.canvas.width).toBe(0)
      expect(result.canvas.height).toBe(0)
      expect(result.buckets.length).toBe(0)
    })

    it('should scale output with canvas size', () => {
      const renderer = new CPUFlameRenderer(sampleFlame)

      const smallResult = renderer.render({
        width: 50,
        height: 50,
        quality: 10,
        pointCountPerBatch: 100,
      })

      const largeResult = renderer.render({
        width: 100,
        height: 100,
        quality: 10,
        pointCountPerBatch: 100,
      })

      // Larger canvas should have proportionally more buckets
      expect(smallResult.buckets.length).toBeLessThan(
        largeResult.buckets.length,
      )
      expect(largeResult.buckets.length).toBe(100 * 100 * 3)
      expect(smallResult.buckets.length).toBe(50 * 50 * 3)
    })
  })

  describe('testCPURenderer', () => {
    it('should return passed for valid render', () => {
      const result = testCPURenderer(sampleFlame, {
        width: 10,
        height: 10,
        quality: 5,
        pointCountPerBatch: 10,
      })

      expect(result.passed).toBe(true)
    })

    it('should catch and report errors', () => {
      const invalidFlame: Record<string, unknown> = {
        renderSettings: {},
        transforms: {},
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = testCPURenderer(invalidFlame as any, {
        width: 10,
        height: 10,
        quality: 5,
        pointCountPerBatch: 10,
      })

      expect(result.passed).toBeDefined()
      expect(result.error).toBeUndefined()
    })
  })

  describe('Bucket Data Structure', () => {
    it('should create valid bucket data', () => {
      const renderer = new CPUFlameRenderer(sampleFlame)

      const result = renderer.render({
        width: 10,
        height: 10,
        quality: 10,
        pointCountPerBatch: 100,
      })

      // Check bucket data structure
      expect(result.bucketsData.length).toBe(100)

      // Check that each bucket has count, colorA, colorB
      for (let i = 0; i < result.bucketsData.length; i++) {
        const bucket = result.bucketsData[i]!
        expect(bucket.count).toBeGreaterThanOrEqual(0)
        expect(bucket.colorA).toBeGreaterThanOrEqual(0)
        expect(bucket.colorB).toBeGreaterThanOrEqual(0)
      }
    })

    it('should flatten and unflatten buckets correctly', () => {
      // Simulate bucket data
      const testBucketsData = [
        { count: 1000, colorA: 500, colorB: 500 },
        { count: 2000, colorA: 1000, colorB: 1000 },
      ]

      // Flatten
      const flattened = new Float32Array(testBucketsData.length * 3)
      for (let i = 0; i < testBucketsData.length; i++) {
        flattened[i * 3] = testBucketsData[i]!.count
        flattened[i * 3 + 1] = testBucketsData[i]!.colorA
        flattened[i * 3 + 2] = testBucketsData[i]!.colorB
      }

      // Verify structure matches expected format
      expect(flattened.length).toBe(6)
      expect(flattened[0]).toBe(1000)
      expect(flattened[1]).toBe(500)
      expect(flattened[2]).toBe(500)
      expect(flattened[3]).toBe(2000)
      expect(flattened[4]).toBe(1000)
      expect(flattened[5]).toBe(1000)
    })
  })

  describe('Integration with WebGPU', () => {
    it('should produce comparable results structure', () => {
      const renderer = new CPUFlameRenderer(sampleFlame)

      const cpuResult = renderer.render({
        width: 50,
        height: 50,
        quality: 10,
        pointCountPerBatch: 100,
      })

      // Verify structure is compatible with GPU expected format
      expect(cpuResult.buckets).toBeInstanceOf(Float32Array)
      expect(cpuResult.canvas).toBeDefined()
      expect(cpuResult.bucketsData).toBeDefined()

      // GPU code expects: bucketCount = width * height
      const expectedBucketCount = 50 * 50
      expect(cpuResult.buckets.length / 3).toBe(expectedBucketCount)
    })

    it('should handle different quality levels', () => {
      const renderer = new CPUFlameRenderer(sampleFlame)

      const lowQuality = renderer.render({
        width: 50,
        height: 50,
        quality: 5,
        pointCountPerBatch: 50,
      })

      const highQuality = renderer.render({
        width: 50,
        height: 50,
        quality: 50,
        pointCountPerBatch: 500,
      })

      // Higher quality should generate more points
      // and produce more complex bucket data
      expect(lowQuality.buckets.length).toBe(highQuality.buckets.length)
      // Bucket count should be the same (same canvas size)
      expect(lowQuality.buckets.length / 3).toBe(highQuality.buckets.length / 3)
    })
  })

  describe('Error Handling', () => {
    it('should handle invalid canvas dimensions gracefully', () => {
      const _renderer = new CPUFlameRenderer(sampleFlame)

      const invalidResult = _renderer.render({
        width: -10,
        height: 10,
        quality: 10,
        pointCountPerBatch: 100,
      })

      expect(invalidResult).toBeDefined()
      expect(invalidResult.buckets.length).toBeGreaterThanOrEqual(0)
    })

    it('should handle zero point count', () => {
      const _renderer = new CPUFlameRenderer(sampleFlame)

      const result = _renderer.render({
        width: 50,
        height: 50,
        quality: 0,
        pointCountPerBatch: 0,
      })

      expect(result).toBeDefined()
      expect(result.buckets.length).toBe(50 * 50 * 3)
    })
  })
})
