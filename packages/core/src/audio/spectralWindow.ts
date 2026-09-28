// The analysis window both audio analyzers apply before the FFT. Cutting a
// frame out of a signal with square edges smears a bass note's energy into
// every higher band; a Hann window tapers the edges to zero, so each band
// hears its own frequencies.

/** A periodic Hann window of `size` samples: 0 at the first sample, 1 at the
 *  middle. */
export function hannWindow(size: number): Float32Array<ArrayBuffer> {
  const window = new Float32Array(size)
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size)
  }
  return window
}
