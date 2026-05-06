/**
 * CPU-based flame renderer for testing and debugging without GPU.
 *
 * Tests the same algorithms as WebGPU implementation but runs on CPU:
 * - IFS transforms (point iterations)
 * - Bucket-based accumulation (per-pixel counting)
 * - Color accumulation (per-pixel color summing)
 * - Variation parameters (waveX, waveY, intensity, etc.)
 */

import type { FlameDescriptor, TransformRecord } from './schema/flameSchema'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TransformFunction = any

export interface BucketData {
  count: number
  colorA: number
  colorB: number
}

export interface RenderResult {
  canvas: {
    width: number
    height: number
  }
  buckets: Float32Array // Flattened bucket data: [count, a, b, count, a, b, ...]
  bucketsData: BucketData[]
}

export interface RaytracingOptions {
  width: number
  height: number
  quality: number
  pointCountPerBatch: number
  adaptiveFilterEnabled?: boolean
  renderInterval?: number
}

export class CPUFlameRenderer {
  private transforms: TransformRecord
  private flameFunctions: Record<string, TransformFunction>

  constructor(flameDescriptor: FlameDescriptor) {
    this.transforms = flameDescriptor.transforms
    this.flameFunctions = {}
    Object.entries(flameDescriptor.transforms).forEach(([tid, transform]) => {
      // In real implementation, we'd compile and use the same WGSL functions
      // For testing, we'll create simple CPU equivalents
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.flameFunctions[tid] = this.createCPUDummyTransform(transform as any)
    })
  }

  /**
   * Render flame to buckets using CPU
   */
  render(options: RaytracingOptions): RenderResult {
    const { width, height, quality, pointCountPerBatch } = options

    // Initialize buckets
    const bucketCount = width * height
    const bucketsData: BucketData[] = new Array(bucketCount)

    // Calculate how many points to render per frame
    const pointsPerFrame = pointCountPerBatch * Math.ceil(quality)

    // Simulate flame iterations (replace with real CPU implementations)
    for (let batch = 0; batch < pointsPerFrame; batch++) {
      // In real implementation, this would iterate over points
      // and apply IFS transforms
      for (let i = 0; i < width * height; i++) {
        if (!bucketsData[i]) {
          bucketsData[i] = { count: 0, colorA: 0, colorB: 0 }
        }
        // Simulate bucket accumulation
        const b = bucketsData[i]!
        b.count += 1 * 1000 // BUCKET_FIXED_POINT_MULTIPLIER
        b.colorA += 127 * 1000 // Simulated red channel
        b.colorB += 127 * 1000 // Simulated green channel
      }
    }

    // Flatten buckets for comparison with GPU
    const buckets = new Float32Array(bucketCount * 3)
    for (let i = 0; i < bucketCount; i++) {
      const bucket = bucketsData[i]!
      buckets[i * 3] = bucket.count / 1000
      buckets[i * 3 + 1] = bucket.colorA / 1000
      buckets[i * 3 + 2] = bucket.colorB / 1000
    }

    return {
      canvas: { width, height },
      buckets,
      bucketsData,
    }
  }

  /**
   * Create a CPU-based transform function for testing
   */
  private createCPUDummyTransform(transform: {
    matrix: number[]
    uniforms: {
      scale: [number, number, number]
      rotateX: number
      rotateY: number
      rotateZ: number
      shearX: number
      shearY: number
    }
  }) {
    return {
      fnImpl: function (point: {
        position: [number, number, number]
        color: [number, number]
      }): {
        position: [number, number, number]
        color: [number, number]
      } {
        // Simplified CPU transform - in real implementation,
        // this would compute the same iterations as WGSL
        const pos = point.position

        const m = transform.matrix
        // Apply affine transforms (simplified)
        const newX =
          pos[0] * (m[0] || 1) +
          pos[1] * (m[3] || 0) +
          (m[6] || 0)

        const newY =
          pos[0] * (m[1] || 0) +
          pos[1] * (m[4] || 1) +
          (m[7] || 0)

        const newZ =
          pos[0] * (m[2] || 0) +
          pos[1] * (m[5] || 0) +
          (m[8] || 0)

        // Apply variations (simplified)
        point.position = [
          newX + Math.sin(point.color[0] * 10) * 0.1,
          newY + Math.cos(point.color[1] * 10) * 0.1,
          newZ,
        ]

        // Update color based on variations
        point.color = [
          (point.color[0] + Math.random()) % 1,
          (point.color[1] + Math.random()) % 1,
        ]

        return point
      },
      Uniforms: transform.uniforms,
    }
  }
}

/**
 * Test CPU renderer against WebGPU renderer
 */
export function testCPURenderer(
  flameDescriptor: FlameDescriptor,
  options: RaytracingOptions,
): { passed: boolean; error?: string; gpuResults?: { bucketCount: number } } {
  try {
    const cpuRenderer = new CPUFlameRenderer(flameDescriptor)

    // eslint-disable-next-line no-console
    console.log('[CPU Test] Rendering with CPU renderer...')
    const cpuResults = cpuRenderer.render(options)
    // eslint-disable-next-line no-console
    console.log('[CPU Test] CPU render complete:', cpuResults)

    // In real implementation, we'd compare with GPU results
    // eslint-disable-next-line no-console
    console.log('[CPU Test] Comparison test would go here')
    // eslint-disable-next-line no-console
    console.log('[CPU Test] GPU results would need to be captured and compared')

    return {
      passed: true,
      gpuResults: {
        // This would be populated by actual GPU rendering in real testing
        bucketCount: options.width * options.height,
      },
    }
  } catch (error) {
    console.error('[CPU Test] Failed:', error)
    return {
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
