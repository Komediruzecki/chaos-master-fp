// Serializable world appearance shared by scenes and Node verification without GPU imports.

export interface WorldVisualDescriptor {
  version: 1
  style: 1 | 2
  low: readonly [number, number, number]
  high: readonly [number, number, number]
}

export const WORLD_VISUALS = {
  glasswake: {
    version: 1,
    style: 1,
    low: [0.62, 0.34, 0.095],
    high: [1, 0.94, 0.75],
  },
  tideweave: {
    version: 1,
    style: 2,
    low: [0.006, 0.2, 0.23],
    high: [0.36, 0.92, 0.86],
  },
} as const satisfies Record<string, WorldVisualDescriptor>

export type WorldVisualId = keyof typeof WORLD_VISUALS
