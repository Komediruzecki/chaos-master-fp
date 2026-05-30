import { qualityPresets } from '@/components/Quality/QualityPresets'
import type { QualityPreset } from '@/components/Quality/QualityPresets'

const { navigator } = globalThis

export type HardwareTier = 'low' | 'mid' | 'high' | 'ultra'

export const hardwareTiers: HardwareTier[] = ['low', 'mid', 'high', 'ultra']

export const hardwareTierToQuality: Record<HardwareTier, number> = {
  low: qualityPresets.low,
  mid: qualityPresets.mid,
  high: qualityPresets.high,
  ultra: qualityPresets.ultra,
}

export function hardwareTierToPreset(tier: HardwareTier): QualityPreset {
  return tier as QualityPreset
}

const ULTRA_VRAM_BYTES = 12 * 1024 * 1024 * 1024
const HIGH_VRAM_BYTES = 6 * 1024 * 1024 * 1024
const MID_VRAM_BYTES = 2 * 1024 * 1024 * 1024

const ULTRA_KEYWORDS = [
  '4090', '4080', '7900 xtx', '7900 xt', 'm4 ultra', 'm3 ultra',
  'pro 32', 'pro w', 'a100', 'h100', 'rx 7900',
]
const HIGH_KEYWORDS = [
  '4070', '4060 ti', '4060', '7800 xt', '7700 xt', 'm4 pro', 'm3 pro',
  'm2 pro', 'm1 pro', 'rtx 3080', 'rtx 3090', 'rx 6800', 'rx 6900',
  'arc a770', 'arc a750',
]

function getVramBytes(adapter: GPUAdapter): number {
  const info = adapter.info as unknown as Record<string, unknown>
  const heaps = info.memoryHeaps as { size: number }[] | undefined
  if (heaps && heaps.length > 0) {
    return heaps.reduce((sum, h) => sum + h.size, 0)
  }
  return 0
}

function classifyByVram(vramBytes: number): HardwareTier | null {
  if (vramBytes >= ULTRA_VRAM_BYTES) return 'ultra'
  if (vramBytes >= HIGH_VRAM_BYTES) return 'high'
  if (vramBytes >= MID_VRAM_BYTES) return 'mid'
  return null
}

function classifyByDescription(description: string): HardwareTier | null {
  const lower = description.toLowerCase()
  if (ULTRA_KEYWORDS.some((k) => lower.includes(k))) return 'ultra'
  if (HIGH_KEYWORDS.some((k) => lower.includes(k))) return 'high'
  return null
}

function classifyByVendorAndCores(
  vendor: string,
  cores: number,
): HardwareTier {
  const isDiscrete = vendor === 'nvidia' || vendor === 'amd'
  if (isDiscrete) return cores >= 4 ? 'mid' : 'low'
  // Integrated / mobile GPU
  if (cores >= 8) return 'mid'
  return 'low'
}

export async function detectHardwareTier(): Promise<HardwareTier> {
  if (!('gpu' in navigator)) return 'mid'

  try {
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) return 'mid'

    const { vendor, architecture: _architecture, description } = adapter.info

    // VRAM-based classification (most reliable, Chrome only)
    const vramBytes = getVramBytes(adapter)
    const vramTier = classifyByVram(vramBytes)
    if (vramTier) {
      // VRAM gives us a baseline — bump up if description suggests higher tier
      const descTier = classifyByDescription(description)
      if (descTier) {
        // Use the higher of the two
        const tierOrder: HardwareTier[] = ['low', 'mid', 'high', 'ultra']
        const vramIdx = tierOrder.indexOf(vramTier)
        const descIdx = tierOrder.indexOf(descTier)
        return descIdx > vramIdx ? descTier : vramTier
      }
      return vramTier
    }

    // No VRAM info — try description-based classification
    const descTier = classifyByDescription(description)
    if (descTier) return descTier

    // Fall back to vendor + CPU cores heuristic
    const cores = navigator.hardwareConcurrency || 4
    return classifyByVendorAndCores(vendor, cores)
  } catch {
    return 'mid'
  }
}
