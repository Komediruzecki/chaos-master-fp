import type { TourGuide } from '@/components/SpotlightTour/tourTypes'

export const flameCreationTour: TourGuide = {
  id: 'flame-creation',
  name: 'Build Your First Flame',
  description:
    'A guided walkthrough building a fractal flame from scratch — transforms, variations, color, and blending.',
  steps: [
    {
      target: '',
      title: 'Welcome',
      description:
        "Let's build a fractal flame together from scratch. I'll guide you step by step — just click Next or press Enter.",
      position: 'auto',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.setSkipIters', 1)
        ctx.executeCommand('camera.center')
      },
    },
    {
      target: '[data-tour-target="canvas"]',
      title: 'The Starting Point',
      description:
        'This is your canvas. Right now it shows the raw seed of a flame — pure mathematical chaos with no transforms applied. Every beautiful fractal starts here.',
    },
    {
      target: '',
      title: 'Add a Transform',
      description:
        'Transforms are functions that map points to new positions through repeated iteration. Let\'s add the first building block — a linear transform.',
      position: 'auto',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.addTransform', 'linear')
      },
    },
    {
      target: '',
      title: 'Add Spherical Variation',
      description:
        'Variations modify how a transform behaves. Spherical creates smooth bubble-like patterns. Notice how the flame structure changes.',
      position: 'auto',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.addVariation', 0, 'spherical')
        ctx.executeCommand('flame.setVariationWeight', 0, 0, 1)
      },
    },
    {
      target: '',
      title: 'Add Sinusoidal Variation',
      description:
        'Sinusoidal variation creates wavy, organic shapes. Multiple variations on the same transform blend together to create unique textures.',
      position: 'auto',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.addVariation', 0, 'sinusoidal')
        ctx.executeCommand('flame.setVariationWeight', 0, 1, 0.5)
      },
    },
    {
      target: '',
      title: 'Second Transform',
      description:
        'Real fractal flames use multiple transforms that feed into each other recursively. Let\'s add a second transform with its own variation.',
      position: 'auto',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.addTransform', 'sinusoidal')
      },
    },
    {
      target: '',
      title: 'Adjust Transform Weights',
      description:
        'Each transform has a probability weight that controls how often it\'s chosen during iteration. Balanced weights create even distributions.',
      position: 'auto',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.setVariationWeight', 1, 0, 0.8)
      },
    },
    {
      target: '',
      title: 'Add Color Speed',
      description:
        'Color speed controls how quickly hues change as the flame iterates. A value of 0.3 creates gentle color gradients across the structure.',
      position: 'auto',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.setColorSpeed', 0, 0.3)
      },
    },
    {
      target: '',
      title: 'Blend Weight',
      description:
        'The blend weight controls crossfading between your flame and a blend target. Setting it to 0 opens up creative possibilities for mixing flames later.',
      position: 'auto',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.setBlendWeight', 0)
      },
    },
    {
      target: '[data-tour-target="export-png"]',
      title: 'Export Your Flame',
      description:
        'When you\'re happy with your creation, export it as a high-resolution PNG image. You can also export animations and share links.',
    },
    {
      target: '',
      title: "You're Ready!",
      description:
        'Congratulations! You\'ve built your first fractal flame. Experiment with more transforms, variations, and animation to create your own unique art. Try the other tours to learn more about the sidebar and timeline.',
      position: 'auto',
    },
  ],
  nextTourId: 'app',
  nextTourLabel: 'App Tour',
}
