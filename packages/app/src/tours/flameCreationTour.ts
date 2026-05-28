import type { TourGuide } from '@/components/SpotlightTour/tourTypes'

export const flameCreationTour: TourGuide = {
  id: 'flame-creation',
  name: 'Explore Flame 1',
  description:
    'A guided walkthrough of Flame 1 — explore transforms, variations, affines, and export step by step.',
  steps: [
    {
      target: '',
      title: 'Loading Flame 1',
      description:
        "Let's explore Flame 1 — a classic fractal built from 4 transforms with carefully balanced probabilities and a mix of variation types.",
      position: 'auto',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.loadPreset', 'example1')
        ctx.executeCommand('camera.center')
      },
    },
    {
      target: '[data-tour-target="canvas"]',
      title: 'The Rendered Flame',
      description:
        'This is the final output — rich structure from 4 transforms that feed into each other recursively. Drag to pan, scroll to zoom in and out.',
    },
    {
      target: '[data-tour-target="sidebar"]',
      title: 'Transform Stack',
      description:
        'Open the sidebar to see the transforms that make up this flame. Each has its own probability weight, color coordinates, affine transforms, and variation mix.',
      beforeShow: (ctx) => ctx.setSidebarOpen(true),
    },
    {
      target: '[data-tour-target="probability"]',
      title: 'Transform Probabilities',
      description:
        'Probabilities control how often each transform fires. This flame uses a descending pattern: 40% → 30% → 20% → 10%. The first transform dominates the structure, while later ones add detail.',
      beforeShow: (ctx) => ctx.setSidebarOpen(true),
    },
    {
      target: '[data-tour-target="variation-type"]',
      title: 'Variation Types',
      description:
        'Each transform mixes multiple variation types. Click a name to see the full picker. This flame combines linear (structure), swirl (spirals), popcorn (noise), pie (wedges), gaussian (glow), and sinusoidal (waves).',
      beforeShow: (ctx) => ctx.setSidebarOpen(true),
    },
    {
      target: '[data-tour-target="variation-weight"]',
      title: 'Variation Weights',
      description:
        'Weights control how strongly each variation contributes when a transform fires. On transform 2, swirl (0.5) dominates over linear (0.4) and popcorn (0.1), giving it that distinctive spiral character.',
      beforeShow: (ctx) => ctx.setSidebarOpen(true),
    },
    {
      target: '[data-tour-target="affine-tabs"]',
      title: 'Affine Transforms',
      description:
        'Pre and post affines control position, rotation, and scale. Switch between Grid and List views, and toggle Pre/Post to see how transform 3 uses a post-affine rotation (90°) to spin the pie wedges.',
      beforeShow: (ctx) => ctx.setSidebarOpen(true),
    },
    {
      target: '[data-tour-target="view-controls"]',
      title: 'Camera Controls',
      description:
        'Zoom in/out, pan with arrow keys, or click Center to frame the flame. The zoom level and position determine which portion of the fractal fills your screen.',
    },
    {
      target: '[data-tour-target="export-png"]',
      title: 'Export Your Flame',
      description:
        'When you find a composition you love, export it as a high-resolution PNG image. You can also export animations, save for later, and share links.',
    },
    {
      target: '',
      title: "You're Ready!",
      description:
        'Now you understand the anatomy of a fractal flame. Try swapping variation types, adjusting affine coefficients, or loading other presets. Use the remaining tours to dive deeper into the sidebar, timeline, and app features.',
      position: 'auto',
    },
  ],
  nextTourId: 'sidebar',
  nextTourLabel: 'Sidebar Deep Dive',
}
