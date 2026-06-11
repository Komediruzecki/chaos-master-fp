import type { EditorFor } from './types'

const noopEditor: EditorFor<number> = () => undefined
export const RangeEditor: EditorFor<number> = noopEditor
