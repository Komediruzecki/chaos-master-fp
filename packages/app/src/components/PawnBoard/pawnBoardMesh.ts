/** Triangle-list board boxes, with outward flat normals and no GPU resource ownership. */
export function cube(
  width: number,
  height: number,
  depth: number,
): Float32Array<ArrayBuffer> {
  const x = width / 2,
    y = height / 2,
    z = depth / 2
  const faces = [
    [
      [x, -y, -z],
      [x, y, -z],
      [x, y, z],
      [x, -y, z],
      [1, 0, 0],
    ],
    [
      [-x, -y, z],
      [-x, y, z],
      [-x, y, -z],
      [-x, -y, -z],
      [-1, 0, 0],
    ],
    [
      [-x, y, -z],
      [-x, y, z],
      [x, y, z],
      [x, y, -z],
      [0, 1, 0],
    ],
    [
      [-x, -y, z],
      [-x, -y, -z],
      [x, -y, -z],
      [x, -y, z],
      [0, -1, 0],
    ],
    [
      [x, -y, z],
      [x, y, z],
      [-x, y, z],
      [-x, -y, z],
      [0, 0, 1],
    ],
    [
      [-x, -y, -z],
      [-x, y, -z],
      [x, y, -z],
      [x, -y, -z],
      [0, 0, -1],
    ],
  ]
  const vertices: number[] = []
  for (const face of faces)
    for (const corner of [0, 1, 2, 0, 2, 3])
      vertices.push(...face[corner]!, ...face[4]!)
  return new Float32Array(vertices)
}
