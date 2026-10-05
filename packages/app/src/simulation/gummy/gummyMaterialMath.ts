/** Allocation-free small-matrix products shared by CPU material and fracture assessment. */

/** Ds times the inverse material frame. Explicit products avoid nested indexed accumulation per cell. */
export function writeGummyDeformation(
  positions: Float32Array,
  tets: Uint32Array,
  gradients: Float32Array | Float64Array,
  tet: number,
  target: Float64Array,
) {
  const a = tets[tet * 4]! * 4,
    b = tets[tet * 4 + 1]! * 4,
    c = tets[tet * 4 + 2]! * 4,
    d = tets[tet * 4 + 3]! * 4,
    offset = tet * 9
  const g0 = gradients[offset]!,
    g1 = gradients[offset + 1]!,
    g2 = gradients[offset + 2]!,
    g3 = gradients[offset + 3]!,
    g4 = gradients[offset + 4]!,
    g5 = gradients[offset + 5]!,
    g6 = gradients[offset + 6]!,
    g7 = gradients[offset + 7]!,
    g8 = gradients[offset + 8]!
  for (let row = 0; row < 3; row++) {
    const x = positions[b + row]! - positions[a + row]!,
      y = positions[c + row]! - positions[a + row]!,
      z = positions[d + row]! - positions[a + row]!
    target[row * 3] = x * g0 + y * g3 + z * g6
    target[row * 3 + 1] = x * g1 + y * g4 + z * g7
    target[row * 3 + 2] = x * g2 + y * g5 + z * g8
  }
}

/** F^T F: compute each symmetric entry once, with the original summation order. */
export function writeGummyRightTensor(
  f: ArrayLike<number>,
  target: Float64Array,
) {
  const a = f[0]!,
    b = f[1]!,
    c = f[2]!,
    d = f[3]!,
    e = f[4]!,
    g = f[5]!,
    h = f[6]!,
    i = f[7]!,
    j = f[8]!
  target[0] = a * a + d * d + h * h
  target[4] = b * b + e * e + i * i
  target[8] = c * c + g * g + j * j
  target[1] = target[3] = a * b + d * e + h * i
  target[2] = target[6] = a * c + d * g + h * j
  target[5] = target[7] = b * c + e * g + i * j
}

/** F F^T: the same tensor in world coordinates, for objective face opening. */
export function writeGummyLeftTensor(
  f: ArrayLike<number>,
  target: Float64Array,
) {
  const a = f[0]!,
    b = f[1]!,
    c = f[2]!,
    d = f[3]!,
    e = f[4]!,
    g = f[5]!,
    h = f[6]!,
    i = f[7]!,
    j = f[8]!
  target[0] = a * a + b * b + c * c
  target[4] = d * d + e * e + g * g
  target[8] = h * h + i * i + j * j
  target[1] = target[3] = a * d + b * e + c * g
  target[2] = target[6] = a * h + b * i + c * j
  target[5] = target[7] = d * h + e * i + g * j
}
