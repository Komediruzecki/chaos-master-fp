/**
 * Wrapper around the 'typegpu' npm package that patches tgpu.fn and
 * tgpu.computeFn at the namespace-object level via Proxy.
 *
 * The real tgpu namespace uses non-configurable getters, so we can't
 * Object.defineProperty over them. Instead we export our own tgpu object
 * (a Proxy that intercepts 'fn' and 'computeFn' property access).
 *
 * All non-tgpu-namespace exports (data, std, common, type guards, errors)
 * are re-exported as-is, unmodified.
 */

import { tgpu as _tgpu } from 'npm:typegpu@0.11.9'
import { extractWgslFromUseGpu } from './wgslExtractor.ts'

const createdLayouts = new Set<any>()

// Free-identifier externals for extracted "use gpu" functions. The app build
// resolves closure references through unplugin-typegpu; here the extraction
// only yields WGSL text, so the render entry registers the runtime values
// (e.g. { drawMode, oklabToRgb } before creating the color-grading pipeline)
// and the wrapper $uses-injects whichever names appear in the source.
const registeredUses = new Map<string, unknown>()

export function registerRuntimeUses(uses: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(uses)) {
    registeredUses.set(name, value)
  }
}

/**
 * Non-builtin ("varying") input names of an entry-fn shell. typegpu 0.11
 * template entry fns receive BUILTIN inputs as named WGSL params, but location
 * varyings only exist on the generated `in` struct — bodies must read
 * `in.<name>`. We alias each referenced varying at the top of the body so the
 * extracted/authored code can keep using the bare name.
 */
function varyingsOf(shell: unknown): string[] {
  const rec = (
    shell as
      | {
          in?: Record<string, { attribs?: { type?: string }[] } | undefined>
        }
      | undefined
  )?.in
  if (!rec) return []
  return Object.entries(rec)
    .filter(([, v]) => !v?.attribs?.some?.((a) => a?.type === '@builtin'))
    .map(([k]) => k)
}

/** Prepend `let <name> = in.<name>;` for each varying referenced in the body. */
function aliasVaryings(bodyWgsl: string, varyings: string[]): string {
  const aliases = varyings
    .filter((name) => new RegExp(`\\b${name}\\b`).test(bodyWgsl))
    .map((name) => `  let ${name} = in.${name};`)
    .join('\n')
  if (!aliases) return bodyWgsl
  return bodyWgsl.replace('{', `{\n${aliases}`)
}

function wrapCallable(
  callable: (...args: unknown[]) => unknown,
  isEntryFn = false,
  varyings: string[] = [],
): typeof callable {
  return new Proxy(callable, {
    apply(target, thisArg, args) {
      const [impl, ...rest] = args
      if (typeof impl === 'function') {
        const source = impl.toString()
        const matches = source.matchAll(
          /\b([a-zA-Z0-9_]+)\.\$\.([a-zA-Z0-9_]+)/g,
        )
        const usesObj: Record<string, any> = {}
        for (const match of matches) {
          const layoutVarName = match[1]!
          const entryName = match[2]!
          for (const layout of createdLayouts) {
            const internalSym = Object.getOwnPropertySymbols(layout).find((s) =>
              s.toString().includes('$internal'),
            )
            const bound = internalSym ? layout[internalSym]?.bound : undefined
            if (bound && entryName in bound) {
              usesObj[layoutVarName] = layout
              break
            }
          }
        }
        for (const [name, value] of registeredUses) {
          if (!(name in usesObj) && new RegExp(`\\b${name}\\b`).test(source)) {
            usesObj[name] = value
          }
        }

        try {
          let wgsl = extractWgslFromUseGpu(impl, isEntryFn)
          if (isEntryFn) {
            wgsl = aliasVaryings(wgsl, varyings)
          }
          const result = Reflect.apply(target, thisArg, [wgsl, ...rest])
          if (
            Object.keys(usesObj).length > 0 &&
            typeof (result as any)?.$uses === 'function'
          ) {
            return (result as any).$uses(usesObj)
          }
          return result
        } catch {
          // Extraction failed — pass through, will fail at resolution time
        }
      } else if (typeof impl === 'string' || Array.isArray(impl)) {
        let code = ''
        if (Array.isArray(impl)) {
          const strings = impl as string[]
          const values = rest
          for (let i = 0; i < strings.length; i++) {
            code += strings[i]
            if (i < values.length) {
              code += String(values[i])
            }
          }
        } else {
          code = impl
        }

        const match = code.match(/^\s*\(([^)]*)\)\s*\{/)
        if (isEntryFn && match) {
          // typegpu 0.11 emits BUILTIN entry inputs as named WGSL params, so
          // template bodies reference those directly — strip our `(params)`
          // header (0.10-era `let x = in.x;` shims collide as redefinitions).
          // Location varyings still live on the generated `in` struct and get
          // aliased below.
          const rewritten = aliasVaryings(
            `{\n${code.slice(match[0].length)}`,
            varyings,
          )
          return Reflect.apply(target, thisArg, [rewritten])
        }
      }
      return Reflect.apply(target, thisArg, args)
    },
    get(target, prop, receiver) {
      return Reflect.get(target, prop, receiver)
    },
  })
}

const _originalFn = _tgpu.fn.bind(_tgpu)

const patchedFn: typeof _tgpu.fn = function (
  ...args: Parameters<typeof _tgpu.fn>
) {
  const callable = _originalFn(...args)
  return wrapCallable(
    callable as unknown as (...a: unknown[]) => unknown,
  ) as unknown as ReturnType<typeof _tgpu.fn>
} as unknown as typeof _tgpu.fn

const _originalComputeFn = _tgpu.computeFn.bind(_tgpu)

const patchedComputeFn: typeof _tgpu.computeFn = function (
  ...args: Parameters<typeof _tgpu.computeFn>
) {
  const callable = _originalComputeFn(args[0])
  return wrapCallable(
    callable as unknown as (...a: unknown[]) => unknown,
    true,
    varyingsOf(args[0]),
  ) as unknown as ReturnType<typeof _tgpu.computeFn>
} as unknown as typeof _tgpu.computeFn

/**
 * Patched tgpu namespace. Every property access is forwarded to the real
 * tgpu, except `fn` and `computeFn` which return our wrapped versions.
 */
const _originalVertexFn = _tgpu.vertexFn.bind(_tgpu)

const patchedVertexFn: typeof _tgpu.vertexFn = function (
  ...args: Parameters<typeof _tgpu.vertexFn>
) {
  const callable = _originalVertexFn(...args)
  return wrapCallable(
    callable as unknown as (...a: unknown[]) => unknown,
    true,
    varyingsOf(args[0]),
  ) as unknown as ReturnType<typeof _tgpu.vertexFn>
} as unknown as typeof _tgpu.vertexFn

const _originalFragmentFn = _tgpu.fragmentFn.bind(_tgpu)

const patchedFragmentFn: typeof _tgpu.fragmentFn = function (
  ...args: Parameters<typeof _tgpu.fragmentFn>
) {
  const callable = _originalFragmentFn(...args)
  return wrapCallable(
    callable as unknown as (...a: unknown[]) => unknown,
    true,
    varyingsOf(args[0]),
  ) as unknown as ReturnType<typeof _tgpu.fragmentFn>
} as unknown as typeof _tgpu.fragmentFn

const _originalBindGroupLayout = _tgpu.bindGroupLayout.bind(_tgpu)

const patchedBindGroupLayout: typeof _tgpu.bindGroupLayout = function (
  ...args: Parameters<typeof _tgpu.bindGroupLayout>
) {
  const layout = _originalBindGroupLayout(...args)
  createdLayouts.add(layout)
  return layout
}

export const tgpu = new Proxy(_tgpu, {
  get(target, prop, receiver) {
    if (prop === 'fn') return patchedFn
    if (prop === 'computeFn') return patchedComputeFn
    if (prop === 'vertexFn') return patchedVertexFn
    if (prop === 'fragmentFn') return patchedFragmentFn
    if (prop === 'bindGroupLayout') return patchedBindGroupLayout
    return Reflect.get(target, prop, receiver)
  },
})

// Re-export everything else from typegpu, unmodified
export * from 'npm:typegpu@0.11.9'
