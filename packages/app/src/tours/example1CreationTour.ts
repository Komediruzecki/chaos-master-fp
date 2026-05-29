import { DEFAULT_ANIMATION_DURATION_MS } from '@/components/SpotlightTour/tourTypes'
import type { TourGuide } from '@/components/SpotlightTour/tourTypes'

/**
 * Granular step-by-step tour that recreates Example 1 from scratch.
 *
 * Each step changes ONE thing and the spotlight moves to the element
 * that just changed. Slider values animate over DEFAULT_ANIMATION_DURATION_MS.
 *
 * NOTE: The probability Slider shows a *relative* percentage
 * (value / totalProbability), so when there is only one transform the
 * displayed "100 %" never changes even though the underlying value does.
 * We still animate it to move the slider thumb visually.
 */

/** Delay (ms) before starting a slider animation after a scroll. */
const SCROLL_SETTLE_MS = 500

export const example1CreationTour: TourGuide = {
  id: 'example1-creation',
  name: 'Example 1 Creation',
  description:
    'Recreate the very first example flame step-by-step from scratch.',
  noBlur: true,
  steps: [
    // ───────────────────────────────────────────────────────
    //  SETUP
    // ───────────────────────────────────────────────────────
    {
      target: '[data-tour-target="canvas"]',
      title: 'Building Example 1',
      description:
        'We start from a blank canvas. All transforms have been cleared and Skip Iterations is set to 1 so you can watch the flame evolve as we add each piece.',
      beforeShow: (ctx) => {
        ctx.setSidebarOpen(true)
        ctx.executeCommand('flame.clearTransforms')
        ctx.executeCommand('flame.setSkipIters', 1)
        ctx.executeCommand('flame.setExposure', 0.25)
        ctx.executeCommand('flame.setDrawMode', 'light')
        ctx.executeCommand('camera.center')
        ctx.executeCommand('camera.zoomTo', 1)
      },
    },

    // ───────────────────────────────────────────────────────
    //  TRANSFORM 1 -- Linear
    // ───────────────────────────────────────────────────────
    {
      target: '[data-tour-target="probability"]',
      targetLast: true,
      title: 'T1: Add Linear Transform',
      description:
        'A new transform appears in the sidebar with the default Linear variation. This will be the stable backbone of the flame.',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.addTransform', 'linear')
        ctx.scrollToTarget('[data-tour-target="probability"]')
      },
    },
    {
      target: '[data-tour-target="probability"]',
      targetLast: true,
      title: 'T1: Probability -> 40%',
      description:
        'Probability controls how often this transform fires. We bring it down to 0.4 (40%), leaving room for other transforms. Note: the displayed percentage is relative to the total.',
      beforeShow: (ctx) => {
        ctx.animateValue(1, 0.4, DEFAULT_ANIMATION_DURATION_MS, (val) => {
          ctx.executeCommand('flame.setProbability', 0, val)
        })
      },
    },
    {
      target: '[data-tour-target="affine-editor"]',
      title: 'T1: Shrink & Offset',
      description:
        'We shrink the transform (a=0.8, e=0.6) and offset it to the right (c=0.5). Watch the affine handle move in the grid and the canvas update.',
      beforeShow: (ctx) => {
        ctx.scrollToTarget('[data-tour-target="affine-editor"]')
        setTimeout(() => {
          ctx.animateValue(1, 0.8, DEFAULT_ANIMATION_DURATION_MS, (val) => {
            ctx.executeCommand('flame.setAffine', 0, 'pre', 'a', val)
          })
        }, SCROLL_SETTLE_MS)
        ctx.executeCommand('flame.setAffine', 0, 'pre', 'b', 0)
        ctx.executeCommand('flame.setAffine', 0, 'pre', 'c', 0.5)
        ctx.executeCommand('flame.setAffine', 0, 'pre', 'd', 0)
        ctx.executeCommand('flame.setAffine', 0, 'pre', 'e', 0.6)
        ctx.executeCommand('flame.setAffine', 0, 'pre', 'f', 0)
        ctx.executeCommand('flame.setTransformColor', 0, 0.1, 0.25)
      },
    },

    // ───────────────────────────────────────────────────────
    //  TRANSFORM 2 -- Linear + Swirl + Popcorn
    // ───────────────────────────────────────────────────────
    {
      target: '[data-tour-target="probability"]',
      targetLast: true,
      title: 'T2: Add Second Transform',
      description:
        'A second transform starts as a plain Linear. We will mix in Swirl and Popcorn to create spiraling arms.',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.addTransform', 'linear')
        ctx.scrollToTarget('[data-tour-target="probability"]')
      },
    },
    {
      target: '[data-tour-target="variation-weight"]',
      targetLast: true,
      title: 'T2: Linear Weight -> 0.4',
      description:
        'The Linear variation on this transform gets a reduced weight of 0.4, leaving room for Swirl and Popcorn.',
      beforeShow: (ctx) => {
        ctx.scrollToTarget('[data-tour-target="variation-weight"]')
        setTimeout(() => {
          ctx.animateValue(1, 0.4, DEFAULT_ANIMATION_DURATION_MS, (val) => {
            ctx.executeCommand('flame.setVariationWeight', 1, 0, val)
          })
        }, SCROLL_SETTLE_MS)
      },
    },
    {
      target: '[data-tour-target="variation-type"]',
      targetLast: true,
      title: 'T2: Add Swirl (0.5)',
      description:
        'Swirl twists points around the origin. At weight 0.5 it dominates the mix, creating the spiraling structure.',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.addVariation', 1, 'swirl')
        ctx.executeCommand('flame.setVariationWeight', 1, 1, 0.5)
        ctx.scrollToTarget('[data-tour-target="variation-type"]')
      },
    },
    {
      target: '[data-tour-target="variation-type"]',
      targetLast: true,
      title: 'T2: Add Popcorn (0.1)',
      description:
        'Popcorn adds fine-grained sinusoidal distortion. Just 0.1 weight gives subtle organic texture without overpowering the swirl.',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.addVariation', 1, 'popcorn')
        ctx.executeCommand('flame.setVariationWeight', 1, 2, 0.1)
        ctx.scrollToTarget('[data-tour-target="variation-type"]')
      },
    },
    {
      target: '[data-tour-target="probability"]',
      targetLast: true,
      title: 'T2: Probability -> 30%',
      description:
        'T2 fires less often than T1. Watch the probability slider animate down to 0.3.',
      beforeShow: (ctx) => {
        ctx.scrollToTarget('[data-tour-target="probability"]')
        setTimeout(() => {
          ctx.animateValue(1, 0.3, DEFAULT_ANIMATION_DURATION_MS, (val) => {
            ctx.executeCommand('flame.setProbability', 1, val)
          })
        }, SCROLL_SETTLE_MS)
      },
    },
    {
      target: '[data-tour-target="affine-editor"]',
      title: 'T2: Shear & Offset',
      description:
        'Shearing the pre-affine (b=0.3, f=0.5) tilts and offsets the spiral. Watch the affine handles shift and the swirl arms appear.',
      beforeShow: (ctx) => {
        ctx.scrollToTarget('[data-tour-target="affine-editor"]')
        ctx.executeCommand('flame.setAffine', 1, 'pre', 'a', 0.7)
        ctx.executeCommand('flame.setAffine', 1, 'pre', 'b', 0.3)
        ctx.executeCommand('flame.setAffine', 1, 'pre', 'c', 0.1)
        ctx.executeCommand('flame.setAffine', 1, 'pre', 'd', 0)
        ctx.executeCommand('flame.setAffine', 1, 'pre', 'e', 0.6)
        ctx.executeCommand('flame.setAffine', 1, 'pre', 'f', 0.5)
        ctx.executeCommand('flame.setTransformColor', 1, -0.3, 0.1)
      },
    },

    // ───────────────────────────────────────────────────────
    //  TRANSFORM 3 -- Pie + Gaussian
    // ───────────────────────────────────────────────────────
    {
      target: '[data-tour-target="probability"]',
      targetLast: true,
      title: 'T3: Add Pie Transform',
      description:
        'The Pie variation splits the plane into angular slices, like a pizza. This creates the characteristic star shape.',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.addTransform', 'pie')
        ctx.scrollToTarget('[data-tour-target="probability"]')
      },
    },
    {
      target: '[data-parameter-path$=".slices"]',
      title: 'T3: Pie Slices -> 5',
      description:
        'The default is 6 slices. Example 1 uses 5, giving a pentagonal star pattern. Watch the shape change on the canvas.',
      beforeShow: (ctx) => {
        ctx.scrollToTarget('[data-parameter-path$=".slices"]')
        setTimeout(() => {
          ctx.animateValue(6, 5, DEFAULT_ANIMATION_DURATION_MS, (val) => {
            ctx.executeCommand(
              'flame.setVariationParams',
              2,
              0,
              'slices',
              Math.round(val),
            )
          })
        }, SCROLL_SETTLE_MS)
      },
    },
    {
      target: '[data-parameter-path$=".rotation"]',
      title: 'T3: Rotation -> 0',
      description:
        'By default the pie is rotated by PI radians (180 degrees). Setting rotation to 0 aligns the slices symmetrically.',
      beforeShow: (ctx) => {
        ctx.scrollToTarget('[data-parameter-path$=".rotation"]')
        setTimeout(() => {
          ctx.animateValue(
            Math.PI,
            0,
            DEFAULT_ANIMATION_DURATION_MS,
            (val) => {
              ctx.executeCommand(
                'flame.setVariationParams',
                2,
                0,
                'rotation',
                val,
              )
            },
          )
        }, SCROLL_SETTLE_MS)
      },
    },
    {
      target: '[data-tour-target="variation-weight"]',
      targetLast: true,
      title: 'T3: Pie Weight -> 0.95',
      description:
        'Pie dominates at 0.95 weight so the star shape is clearly defined.',
      beforeShow: (ctx) => {
        ctx.scrollToTarget('[data-tour-target="variation-weight"]')
        setTimeout(() => {
          ctx.animateValue(1, 0.95, DEFAULT_ANIMATION_DURATION_MS, (val) => {
            ctx.executeCommand('flame.setVariationWeight', 2, 0, val)
          })
        }, SCROLL_SETTLE_MS)
      },
    },
    {
      target: '[data-tour-target="variation-type"]',
      targetLast: true,
      title: 'T3: Add Gaussian (0.05)',
      description:
        'A tiny Gaussian blur (5%) softens the hard edges of the pie slices, making the flame look more natural.',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.addVariation', 2, 'gaussian')
        ctx.executeCommand('flame.setVariationWeight', 2, 1, 0.05)
        ctx.scrollToTarget('[data-tour-target="variation-type"]')
      },
    },
    {
      target: '[data-tour-target="probability"]',
      targetLast: true,
      title: 'T3: Probability -> 20%',
      description:
        'The pie transform fires at 20% probability. The lower rate means it contributes detail without dominating the image.',
      beforeShow: (ctx) => {
        ctx.scrollToTarget('[data-tour-target="probability"]')
        setTimeout(() => {
          ctx.animateValue(1, 0.2, DEFAULT_ANIMATION_DURATION_MS, (val) => {
            ctx.executeCommand('flame.setProbability', 2, val)
          })
        }, SCROLL_SETTLE_MS)
      },
    },
    {
      target: '[data-tour-target="affine-editor"]',
      title: 'T3: Affine & Post-Affine',
      description:
        'The pre-affine shears the space. A 90-degree post-affine rotation gives the star its final orientation. Watch the handles reposition in the affine grid.',
      beforeShow: (ctx) => {
        ctx.scrollToTarget('[data-tour-target="affine-editor"]')
        ctx.executeCommand('flame.setAffine', 2, 'pre', 'a', 0.6)
        ctx.executeCommand('flame.setAffine', 2, 'pre', 'b', 0.5)
        ctx.executeCommand('flame.setAffine', 2, 'pre', 'c', -0.5)
        ctx.executeCommand('flame.setAffine', 2, 'pre', 'd', 0)
        ctx.executeCommand('flame.setAffine', 2, 'pre', 'e', 0.5)
        ctx.executeCommand('flame.setAffine', 2, 'pre', 'f', -0.5)
        ctx.executeCommand('flame.setAffine', 2, 'post', 'a', 0)
        ctx.executeCommand('flame.setAffine', 2, 'post', 'b', -1)
        ctx.executeCommand('flame.setAffine', 2, 'post', 'c', 0)
        ctx.executeCommand('flame.setAffine', 2, 'post', 'd', 1)
        ctx.executeCommand('flame.setAffine', 2, 'post', 'e', 0)
        ctx.executeCommand('flame.setAffine', 2, 'post', 'f', 0)
        ctx.executeCommand('flame.setTransformColor', 2, 0, -0.3)
      },
    },

    // ───────────────────────────────────────────────────────
    //  TRANSFORM 4 -- Sinusoidal
    // ───────────────────────────────────────────────────────
    {
      target: '[data-tour-target="probability"]',
      targetLast: true,
      title: 'T4: Add Sinusoidal Transform',
      description:
        'The Sinusoidal variation bends the entire structure into soft sine waves, adding organic texture.',
      beforeShow: (ctx) => {
        ctx.executeCommand('flame.addTransform', 'sinusoidal')
        ctx.scrollToTarget('[data-tour-target="probability"]')
      },
    },
    {
      target: '[data-tour-target="probability"]',
      targetLast: true,
      title: 'T4: Probability -> 10%',
      description:
        'At just 10% probability, sinusoidal fires rarely but adds a visible organic texture to the flame.',
      beforeShow: (ctx) => {
        ctx.scrollToTarget('[data-tour-target="probability"]')
        setTimeout(() => {
          ctx.animateValue(1, 0.1, DEFAULT_ANIMATION_DURATION_MS, (val) => {
            ctx.executeCommand('flame.setProbability', 3, val)
          })
        }, SCROLL_SETTLE_MS)
      },
    },
    {
      target: '[data-tour-target="affine-editor"]',
      title: 'T4: Affine & Color',
      description:
        'All four transforms are now in place. The flame shape is complete but still very noisy at skip iterations = 1.',
      beforeShow: (ctx) => {
        ctx.scrollToTarget('[data-tour-target="affine-editor"]')
        ctx.executeCommand('flame.setAffine', 3, 'pre', 'a', 0.6)
        ctx.executeCommand('flame.setAffine', 3, 'pre', 'b', 0.5)
        ctx.executeCommand('flame.setAffine', 3, 'pre', 'c', -0.5)
        ctx.executeCommand('flame.setAffine', 3, 'pre', 'd', 0)
        ctx.executeCommand('flame.setAffine', 3, 'pre', 'e', 0.5)
        ctx.executeCommand('flame.setAffine', 3, 'pre', 'f', -0.5)
        ctx.executeCommand('flame.setTransformColor', 3, 1, 0)
      },
    },

    // ───────────────────────────────────────────────────────
    //  RESOLVING THE CHAOS -- Skip Iterations
    // ───────────────────────────────────────────────────────
    {
      target: '[data-tour-target="skipIters-slider"]',
      title: 'Resolving the Chaos (1/3)',
      description:
        'With Skip Iterations at 1, the image is pure noise. Watch the slider climb to 5 -- structure starts to emerge.',
      position: 'top',
      beforeShow: (ctx) => {
        ctx.scrollToTarget('[data-tour-target="skipIters-slider"]')
        setTimeout(() => {
          ctx.animateValue(1, 5, DEFAULT_ANIMATION_DURATION_MS, (val) => {
            ctx.executeCommand('flame.setSkipIters', Math.round(val))
          })
        }, SCROLL_SETTLE_MS)
      },
    },
    {
      target: '[data-tour-target="skipIters-slider"]',
      title: 'Resolving the Chaos (2/3)',
      description:
        'At 10 iterations the spirals, pie slices, and sine waves are clearly visible. The colors separate along the palette.',
      position: 'top',
      beforeShow: (ctx) => {
        ctx.scrollToTarget('[data-tour-target="skipIters-slider"]')
        setTimeout(() => {
          ctx.animateValue(5, 10, DEFAULT_ANIMATION_DURATION_MS, (val) => {
            ctx.executeCommand('flame.setSkipIters', Math.round(val))
          })
        }, SCROLL_SETTLE_MS)
      },
    },
    {
      target: '[data-tour-target="skipIters-slider"]',
      title: 'Resolving the Chaos (3/3)',
      description:
        'Finally, 20 skip iterations -- exactly like the real Example 1. The flame is perfectly crisp.',
      position: 'top',
      beforeShow: (ctx) => {
        ctx.scrollToTarget('[data-tour-target="skipIters-slider"]')
        setTimeout(() => {
          ctx.animateValue(10, 20, DEFAULT_ANIMATION_DURATION_MS, (val) => {
            ctx.executeCommand('flame.setSkipIters', Math.round(val))
          })
        }, SCROLL_SETTLE_MS)
      },
    },

    // ───────────────────────────────────────────────────────
    //  FINAL TOUCHES -- Gamma & Vibrancy
    // ───────────────────────────────────────────────────────
    {
      target: '[data-tour-target="gamma-slider"]',
      title: 'Final Touch: Gamma -> 2.42',
      description:
        'Gamma controls the overall brightness curve. Pushing it from 2.20 to 2.42 lifts the midtones and makes the flame glow.',
      beforeShow: (ctx) => {
        ctx.scrollToTarget('[data-tour-target="gamma-slider"]')
        setTimeout(() => {
          ctx.animateValue(2.2, 2.42, DEFAULT_ANIMATION_DURATION_MS, (val) => {
            ctx.executeCommand('flame.setGamma', val)
          })
        }, SCROLL_SETTLE_MS)
      },
    },
    {
      target: '[data-tour-target="vibrancy-slider"]',
      title: 'Final Touch: Vibrancy -> 0.95',
      description:
        "Vibrancy saturates the colors toward the palette. At 0.95 the flame bursts with color. You've just built Example 1 from scratch!",
      beforeShow: (ctx) => {
        ctx.scrollToTarget('[data-tour-target="vibrancy-slider"]')
        setTimeout(() => {
          ctx.animateValue(
            0.5,
            0.95,
            DEFAULT_ANIMATION_DURATION_MS,
            (val) => {
              ctx.executeCommand('flame.setVibrancy', val)
            },
          )
        }, SCROLL_SETTLE_MS)
      },
    },
  ],
}
