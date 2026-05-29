import type { TourGuide } from '@/components/SpotlightTour/tourTypes'

export const flameCreationTour: TourGuide = {
  id: 'flame-creation',
  name: 'Build a Flame',
  description:
    'Build a fractal flame from scratch — transforms, variations, affine tweaks, animation keyframes, blending, and export.',
  steps: [
    {
      target: '',
      title: "Let's Build a Flame",
      description:
        "We'll build a fractal flame from scratch, step by step. You'll see each transform, variation, and parameter change as it happens. When we're done, you'll have a complete, animatable composition.",
      position: 'auto',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.loadPreset', 'initExample')
        ctx.executeCommand('camera.center')
      },
    },
    {
      target: '[data-tour-target="canvas"]',
      title: 'Start from Chaos',
      description:
        "skipIters=1 with a bare linear transform — raw chaos, no structure. Every iteration runs through this single rule. Let's clear it and build something better.",
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.setSkipIters', 1)
        ctx.executeCommand('flame.clearTransforms')
      },
    },
    {
      target: '[data-tour-target="sidebar"]',
      title: 'First Transform: Sinusoidal',
      description:
        'A sinusoidal variation creates smooth, wavy patterns. Each transform is one iteration rule — the fractal emerges from applying rules recursively thousands of times.',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.addTransform', 'sinusoidal')
        ctx.setSidebarOpen(true)
      },
    },
    {
      target: '[data-tour-target="sidebar"]',
      title: 'Second Transform: Swirl',
      description:
        'Swirl adds spiraling rotation. When two transforms combine, each iteration picks one at random — the interplay of linear + swirl creates complex organic shapes.',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.addTransform', 'swirl')
        ctx.setSidebarOpen(true)
      },
    },
    {
      target: '[data-tour-target="probability"]',
      title: 'Probability Weights',
      description:
        'Probability controls how often each transform fires. Giving sinusoidal 70% and swirl 30% means the wavy structure dominates, with occasional spiral accents.',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.setProbability', 0, 0.7)
        ctx.executeCommand('flame.setProbability', 1, 0.3)
        ctx.setSidebarOpen(true)
      },
    },
    {
      target: '[data-tour-target="variation-type"]',
      title: 'Add Variations',
      description:
        "Each transform can mix multiple variation types. Let's add gaussian blur to transform 1 for a soft glow, and spherical to transform 2 for bubble-like distortion.",
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.addVariation', 0, 'gaussianBlur')
        ctx.executeCommand('flame.addVariation', 1, 'spherical')
        ctx.setSidebarOpen(true)
      },
    },
    {
      target: '[data-tour-target="variation-weight"]',
      title: 'Variation Weights',
      description:
        'Weights control how strongly each variation contributes. On transform 2, reducing swirl to 0.3 and boosting spherical to 0.7 shifts the character from spirals to bubbles.',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.setVariationWeight', 1, 0, 0.3)
        ctx.setSidebarOpen(true)
      },
    },
    {
      target: '[data-tour-target="affine-tabs"]',
      title: 'Post-Affine Rotation',
      description:
        'Post-affines apply after the variation function. Adding a 45° rotation to transform 2 spins the spherical bubbles, creating a more dynamic composition.',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.setAffine', 1, 'post', 'a', 0.7)
        ctx.executeCommand('flame.setAffine', 1, 'post', 'b', -0.7)
        ctx.executeCommand('flame.setAffine', 1, 'post', 'd', 0.7)
        ctx.executeCommand('flame.setAffine', 1, 'post', 'e', 0.7)
        ctx.setSidebarOpen(true)
      },
    },
    {
      target: '[data-tour-target="affine-tabs"]',
      title: 'Pre-Affine Scaling',
      description:
        'Pre-affines scale and translate before the variation. Slightly shrinking transform 1 compacts the sinusoidal waves, tightening the overall structure.',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.setAffine', 0, 'pre', 'a', 0.85)
        ctx.executeCommand('flame.setAffine', 0, 'pre', 'e', 0.85)
        ctx.setSidebarOpen(true)
      },
    },
    {
      target: '[data-tour-target="sidebar"]',
      title: 'Color Speed & Coordinates',
      description:
        'Color speed controls how quickly the color shifts across iterations. Different speeds per transform create rich gradients. Color x/y positions anchor the hue in color space.',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.setColorSpeed', 0, 0.5)
        ctx.executeCommand('flame.setTransformColor', 0, 0.2, 0.6)
        ctx.executeCommand('flame.setColorSpeed', 1, 0.8)
        ctx.executeCommand('flame.setTransformColor', 1, 0.6, 0.2)
        ctx.setSidebarOpen(true)
      },
    },
    {
      target: '[data-tour-target="sidebar"]',
      title: 'Render Settings',
      description:
        'Exposure brightens the flame, vibrancy boosts saturation, gamma adjusts the brightness curve, and contrast sharpens light/dark differences.',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.setExposure', 0.35)
        ctx.executeCommand('flame.setVibrancy', 0.7)
        ctx.executeCommand('flame.setGamma', 2.5)
        ctx.executeCommand('flame.setContrast', 1.15)
        ctx.setSidebarOpen(true)
      },
    },
    {
      target: '[data-tour-target="view-controls"]',
      title: 'Camera Zoom',
      description:
        'Zooming out reveals more of the fractal. You can also pan by dragging on the canvas or using the arrow keys.',
      beforeShow: (ctx) => {
        ctx.executeCommand('camera.zoomTo', 0.65)
        ctx.executeCommand('camera.center')
      },
    },
    {
      target: '[data-tour-target="timeline-section"]',
      title: 'Animation Setup',
      description:
        "The timeline lets you animate any parameter over time. We'll enable animation for 120 frames (4 seconds at 30 fps) and add camera movement keyframes.",
      beforeShow: (ctx) => {
        ctx.executeCommand('timeline.setAnimationEnabled', true)
        ctx.executeCommand('timeline.setDuration', 120)
        ctx.setTimelineOpen(true)
      },
    },
    {
      target: '[data-tour-target="dope-sheet"]',
      title: 'Camera Zoom Keyframes',
      description:
        'At frame 0, zoom is 0.65. At frame 120, zoom is 1.0. The timeline interpolates smoothly between them, creating a slow zoom-in effect.',
      beforeShow: (ctx) => {
        ctx.executeCommand('timeline.setCurrentFrame', 0)
        ctx.executeCommand('timeline.addKeyframe', 'camera.zoom', 0.65, 0)
        ctx.executeCommand('timeline.setCurrentFrame', 120)
        ctx.executeCommand('timeline.addKeyframe', 'camera.zoom', 1.0, 120)
        ctx.setTimelineOpen(true)
      },
    },
    {
      target: '[data-tour-target="dope-sheet"]',
      title: 'Camera Pan Keyframes',
      description:
        'We can also animate camera position. At frame 0 the camera is centered; by frame 120 it pans right and up, revealing different parts of the fractal.',
      beforeShow: (ctx) => {
        ctx.executeCommand('timeline.setCurrentFrame', 0)
        ctx.executeCommand('timeline.addKeyframe', 'camera.x', 0, 0)
        ctx.executeCommand('timeline.addKeyframe', 'camera.y', 0, 0)
        ctx.executeCommand('timeline.setCurrentFrame', 120)
        ctx.executeCommand('timeline.addKeyframe', 'camera.x', 0.3, 120)
        ctx.executeCommand('timeline.addKeyframe', 'camera.y', -0.2, 120)
        ctx.setTimelineOpen(true)
      },
    },
    {
      target: '[data-tour-target="view-controls"]',
      title: 'Blend Flame',
      description:
        'Blending crossfades between two flames. The blend weight slider (0-1) controls the mix. Load a second flame via the blend picker to explore morphing between compositions.',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.setBlendWeight', 0)
      },
    },
    {
      target: '[data-tour-target="export-png"]',
      title: 'Export Your Creation',
      description:
        'Your flame is ready! Export it as a high-resolution PNG, an animated WebM/GIF, or generate a shareable link that preserves all parameters and animation data.',
    },
    {
      target: '',
      title: "You're a Flame Builder!",
      description:
        'You built a fractal flame from raw chaos to a polished, animated composition. You understand transforms, variations, affines, color, render settings, keyframes, and export. Experiment freely — every parameter is yours to explore.',
      position: 'auto',
    },
  ],
  nextTourId: 'sidebar',
  nextTourLabel: 'Sidebar Deep Dive',
}
