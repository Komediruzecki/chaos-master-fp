export interface VariationDocParam {
  name: string
  description: string
  range: string
  type: 'int' | 'float' | 'angle'
}

export interface VariationDoc {
  name: string
  description: string
  math: string
  params?: VariationDocParam[]
}

export const VARIATION_DOCS: Record<string, VariationDoc> = {
  linearVar: {
    name: 'Linear',
    description:
      'Applies the identity transformation scaled by the variation weight. It maps coordinates directly without altering their direction or shape.',
    math: 'F(x, y) = w \\cdot (x, y)',
  },
  linear3D: {
    name: 'Linear 3D',
    description:
      'Applies the 3D identity transformation scaled by the variation weight, keeping coordinates unchanged.',
    math: 'F(x, y, z) = w \\cdot (x, y, z)',
  },
  swirlVar: {
    name: 'Swirl',
    description:
      'Rotates coordinates by an angle proportional to the squared distance from the origin, creating a swirling spiral pattern.',
    math: '\\begin{aligned}\n  r^2 &= x^2 + y^2 \\\\\n  \\theta &= \\arctan2(y, x) + w \\cdot r^2 \\\\\n  F(x, y) &= r \\cdot (\\cos\\theta, \\sin\\theta)\n\\end{aligned}',
  },
  sphericalVar: {
    name: 'Spherical',
    description:
      'Inverts coordinates relative to the unit circle. Points inside the circle are projected outwards, and points outside are pulled inwards.',
    math: '\\begin{aligned}\n  r^2 &= x^2 + y^2 \\\\\n  F(x, y) &= \\frac{w}{r^2} \\cdot (x, y)\n\\end{aligned}',
  },
  horseshoeVar: {
    name: 'Horseshoe',
    description:
      'Bends coordinates into a U-shaped horseshoe pattern by mapping the polar angle and radius.',
    math: '\\begin{aligned}\n  r &= \\sqrt{x^2 + y^2} \\\\\n  \\theta &= \\arctan2(y, x) \\\\\n  F(x, y) &= w \\cdot \\frac{1}{r} \\cdot ((x - y)(x + y), 2xy)\n\\end{aligned}',
  },
  polarVar: {
    name: 'Polar',
    description:
      'Maps rectangular coordinates to polar coordinates, using the angle as x and the radius minus 1 as y.',
    math: '\\begin{aligned}\n  r &= \\sqrt{x^2 + y^2} \\\\\n  \\theta &= \\arctan2(y, x) \\\\\n  F(x, y) &= w \\cdot \\left(\\frac{\\theta}{\\pi}, r - 1\\right)\n\\end{aligned}',
  },
  handkerchiefVar: {
    name: 'Handkerchief',
    description:
      'Produces a folded handkerchief-like pattern by combining trigonometric functions of the polar angle and radius.',
    math: '\\begin{aligned}\n  r &= \\sqrt{x^2 + y^2} \\\\\n  \\theta &= \\arctan2(y, x) \\\\\n  F(x, y) &= w \\cdot r \\cdot (\\sin(\\theta + r), \\cos(\\theta - r))\n\\end{aligned}',
  },
  heartVar: {
    name: 'Heart',
    description:
      'Distorts coordinates based on the angle scaled by radius, yielding cardioid or heart-shaped patterns.',
    math: '\\begin{aligned}\n  r &= \\sqrt{x^2 + y^2} \\\\\n  \\theta &= \\arctan2(y, x) \\\\\n  F(x, y) &= w \\cdot r \\cdot (\\sin(\\theta \\cdot r), -\\cos(\\theta \\cdot r))\n\\end{aligned}',
  },
  discVar: {
    name: 'Disc',
    description:
      'Projects coordinates onto a disc by scaling the polar angle with the radius.',
    math: '\\begin{aligned}\n  r &= \\sqrt{x^2 + y^2} \\\\\n  \\theta &= \\arctan2(y, x) \\\\\n  F(x, y) &= w \\cdot \\frac{\\theta}{\\pi} \\cdot (\\sin(\\pi r), \\cos(\\pi r))\n\\end{aligned}',
  },
  wavesVar: {
    name: 'Waves',
    description:
      'Adds sinusoidal wave offsets along both the x and y axes, introducing periodic ripples.',
    math: 'F(x, y) = w \\cdot (x + 0.1 \\cdot \\sin(y \\cdot 5), y + 0.1 \\cdot \\sin(x \\cdot 5))',
  },
  atanVar: {
    name: 'Arctangent',
    description:
      'Applies the arctangent function to coordinate components, compressing coordinates towards a bounded region.',
    math: 'F(x, y) = w \\cdot \\frac{2}{\\pi} \\arctan(\\text{stretch} \\cdot (x, y))',
    params: [
      {
        name: 'mode',
        description:
          'Specifies dimension axis: 0 for y only, 1 for x only, 2 for both axes.',
        range: '0 to 2',
        type: 'int',
      },
      {
        name: 'stretch',
        description:
          'Scales the coordinate value inside the arctangent function.',
        range: '0.01 to 10.0',
        type: 'float',
      },
    ],
  },
  butterflyFayVar: {
    name: 'Butterfly (Fay)',
    description:
      "Evaluates Fay's butterfly curve, mapping coordinates based on exponential trigonometric functions to form butterfly-wing structures.",
    math: '\\begin{aligned}\n  r &= \\sqrt{x^2 + y^2} \\\\\n  \\theta &= \\arctan2(y, x) \\\\\n  q &= e^{\\cos\\theta} - 2\\cos(4\\theta) + \\sin^5\\left(\\frac{\\theta}{12}\\right) \\\\\n  F(x, y) &= w \\cdot r \\cdot (\\sin\\theta, \\cos\\theta) \\cdot q\n\\end{aligned}',
  },
  hexesVar: {
    name: 'Hexes',
    description:
      'Projects points onto a hexagonal grid structure with customizable scaling, cell size, and rotation.',
    math: 'F(x, y) = \\text{HexGrid}(x, y, \\text{cellsize}, \\text{scale}, \\text{rotate})',
    params: [
      {
        name: 'cellsize',
        description: 'Determines the size of individual hexagonal grid cells.',
        range: '0.01 to 2.0',
        type: 'float',
      },
      {
        name: 'power',
        description: 'Controls grid lines layout exponent.',
        range: '0 to 2',
        type: 'int',
      },
      {
        name: 'rotate',
        description: 'Rotates the hexagonal grid structure.',
        range: '-3.14 to 3.14',
        type: 'angle',
      },
      {
        name: 'scale',
        description: 'Overall scale of grid coordinates.',
        range: '0.1 to 10.0',
        type: 'float',
      },
    ],
  },
}
