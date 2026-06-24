import { latestSchemaVersion } from '../schema/flameSchema'
import { defineExample, tid, vid } from './util'

/**
 * Earth Flame — a glowing planet: a bubble3D sphere body, swirling surface
 * turbulence ("continents"/atmosphere), and a fiery curl/gaussian glow. Built to
 * be spun (drag-to-orbit) as the landing's 3D showcase. WIP — tune colors / affines
 * to taste. 3D preAffine is a 3x4 matrix: rows [a,b,c,d],[e,f,g,h],[i,j,k,l]
 * (last column = translation).
 */
const scale = (s: number) => ({
  a: s,
  b: 0,
  c: 0,
  d: 0,
  e: 0,
  f: s,
  g: 0,
  h: 0,
  i: 0,
  j: 0,
  k: s,
  l: 0,
})
const identity3D = scale(1)

export const example46 = defineExample({
  version: latestSchemaVersion,
  metadata: {
    author: 'chaos-master',
    name: 'Earth Flame',
    description:
      'A glowing 3D planet — a bubble3D sphere wrapped in swirling surface turbulence and a fiery atmospheric glow. Spin it.',
  },
  renderSettings: {
    dimensions: 3,
    exposure: -1.2,
    skipIters: 20,
    drawMode: 'light',
    colorInitMode: 'colorInitZero',
    pointInitMode: 'pointInitUnitBall',
    vibrancy: 1.0,
    contrast: 2.2,
    gamma: 3.0,
    depthColorPower: 0.4,
    lightDirection: [-0.5, 0.4, -0.8],
    lightPower: 0.25,
    highlightPower: 1.0,
    densityEstimationQuality: 0.6,
    estimatorCurve: 0.3,
    camera: { zoom: 1, position: [0, 0] },
    camera3D: {
      theta: 0.6,
      phi: 1.45,
      radius: 2.2,
      target: [0, 0, 0],
      fov: 55,
    },
  },
  transforms: {
    // 1 — sphere body (bubble3D wraps points onto a spherical shell), ocean blue
    [tid('ea11b0d1_5c0a_47e1_9a31_0b6e2f10c001')]: {
      probability: 0.45,
      preAffine: scale(0.92),
      postAffine: identity3D,
      color: { x: -0.12, y: -0.35 },
      variations: {
        [vid('ea11b0d1_5c0a_47e1_9a31_0b6e2f10c011')]: {
          type: 'bubble3D',
          weight: 1,
        },
        [vid('ea11b0d1_5c0a_47e1_9a31_0b6e2f10c012')]: {
          type: 'spherical3D',
          weight: 0.3,
        },
      },
    },
    // 2 — surface turbulence ("continents"/atmosphere), green
    [tid('ea22c1e2_6d1b_48f2_8b42_1c7f3021d002')]: {
      probability: 0.3,
      preAffine: {
        a: 0.85,
        b: 0.12,
        c: 0,
        d: 0,
        e: -0.12,
        f: 0.85,
        g: 0,
        h: 0,
        i: 0,
        j: 0,
        k: 0.85,
        l: 0,
      },
      postAffine: identity3D,
      color: { x: -0.4, y: 0.22 },
      variations: {
        [vid('ea22c1e2_6d1b_48f2_8b42_1c7f3021d021')]: {
          type: 'swirl3D',
          weight: 0.6,
        },
        [vid('ea22c1e2_6d1b_48f2_8b42_1c7f3021d022')]: {
          type: 'sinusoidal3D',
          weight: 0.4,
        },
      },
    },
    // 3 — fiery atmospheric glow, warm orange
    [tid('ea33d2f3_7e2c_49a3_7c53_2d804132e003')]: {
      probability: 0.25,
      preAffine: scale(0.97),
      postAffine: identity3D,
      color: { x: 0.4, y: 0.42 },
      variations: {
        [vid('ea33d2f3_7e2c_49a3_7c53_2d804132e031')]: {
          type: 'curl3D',
          weight: 0.5,
        },
        [vid('ea33d2f3_7e2c_49a3_7c53_2d804132e032')]: {
          type: 'gaussian3D',
          weight: 0.35,
        },
      },
    },
  },
})
