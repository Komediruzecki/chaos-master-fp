import type { EditorFor } from './types'

const noopEditor: EditorFor<number> = () => undefined
export const AngleEditor: EditorFor<number> = noopEditor
