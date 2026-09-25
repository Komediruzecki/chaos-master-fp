// Deterministic prototypes shared by the runtime and scene editor.
import { defineAssets } from '@iwsdk/core'
import { flame } from './scene-assets/flame.scene-asset'
import { stars } from './scene-assets/stars.scene-asset'

export default defineAssets({ Flame: flame, Stars: stars })
