/** Runtime-agnostic editor type stubs for server-side use. */
export type EditorFor<T> = (props: {
  name?: string
  value: T
  setValue: (val: T) => void
  dataParameterPath?: string
}) => unknown

export function editorProps<
  T extends Record<string, unknown>,
  K extends keyof T,
>(
  _props: { value: T; setValue: (val: T) => void; dataParameterPath?: string },
  _key: K,
  _name: string,
  _dataParameterPath?: string,
): {
  name: string
  dataParameterPath?: string
  get value(): T[K]
  setValue(value: T[K]): void
} {
  return {
    name: '',
    get value() {
      return undefined as unknown as T[K]
    },
    setValue(_value: T[K]) {},
  }
}
