/** Shared public controller and properties for native Cinema without a scene import cycle. */
import type { CinemaPlaybackController } from '../GummyBoard/cinemaPlaybackController'
import type { PreparedNativeContact } from './nativeContactPreparation'
import type { nativeMatchFrame } from './nativeFractalMatchFrame'
import type { NativeCinemaRecipe } from '@/pages/GummyBoard/nativeCinemaRecipe'

export type NativeFractalCinemaController = CinemaPlaybackController & {
  readState(): {
    displayTime: number
    effectTime: number
    beforeFen: string
    afterFen: string
    contact?: PreparedNativeContact['motion']['stats']
    pieces: ReturnType<typeof nativeMatchFrame>
  }
}

export type CaptureSize = { width: number; height: number }
export type NativeCinemaProps = {
  recipe: NativeCinemaRecipe
  onController(controller: NativeFractalCinemaController | undefined): void
  onProgress(time: number, playing: boolean): void
  onReady(ready: boolean): void
  onError(message: string): void
}
