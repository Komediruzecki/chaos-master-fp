/** Shared frame-export boundary for gummy physics and native fractal capture playback. */
export type CinemaPlaybackController = {
  info(): {
    ready: boolean
    displayDuration: number
    displayTime: number
    error?: string
    shotId: string
  }
  resetPaused(): Promise<void>
  seekFrame(frame: number, fps?: number): Promise<void>
  setCaptureSize(
    size: { width: number; height: number } | undefined,
  ): Promise<void>
  captureFrame(frame: number, fps: number): Promise<ImageBitmap>
  render(): Promise<void>
  play(): void
  pause(): void
}

export type CinemaExportController = Pick<
  CinemaPlaybackController,
  | 'info'
  | 'pause'
  | 'resetPaused'
  | 'seekFrame'
  | 'setCaptureSize'
  | 'captureFrame'
>
