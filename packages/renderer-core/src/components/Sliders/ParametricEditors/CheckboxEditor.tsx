import type { EditorFor } from './types'

const noopEditor: EditorFor<number> = () => undefined
export const CheckboxEditor: EditorFor<number> = noopEditor
