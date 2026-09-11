/**
 * Runtime WGSL extractor for typegpu 'use gpu' arrow functions.
 *
 * typegpu requires the unplugin-typegpu build plugin to extract WGSL from
 * 'use gpu' function bodies and attach metadata. At runtime in Deno, we
 * don't have the plugin, so this module converts 'use gpu' arrow functions
 * to WGSL strings that typegpu's string API (fnCore.js line 29) can use.
 */

// Values of module-level constants referenced inside 'use gpu' functions.
// unplugin-typegpu resolves these through the closure in the app build; the
// runtime extractor only sees WGSL text, so each one must be inlined here.
// A miss surfaces at render time as "no definition in scope for identifier:
// <NAME>" — add the constant (grep its literal in packages/app/src/flame).
const CONSTANTS: Record<string, string> = {
  'PI.$': '3.141592653589793',
  'EPS.$': '1e-10',
  BUCKET_FIXED_POINT_MULTIPLIER_INV: '0.001',
  EPSILON: '0.001',
  // vogelVar/sunflowerVar: PI * (3 - sqrt(5)).
  GOLDEN_ANGLE: '2.399963229728653',
  // fibonacci2Var: ln(phi)/... natural-log constant.
  FNATLOG: '0.48121182505960347',
  // circleRandVar/circleLinearVar LCG scale: 1 / 2147483647.
  AM: '4.656612875245797e-10',
}

/**
 * Converts a 'use gpu' arrow function implementation to a WGSL string
 * suitable for passing to tgpu.fn([...], returnType) as a template literal.
 *
 * The returned string has the format:
 *   (param1, param2) {
 *     // WGSL body
 *   }
 *
 * which is the format typegpu's extractArgs() expects.
 */
export function extractWgslFromUseGpu(
  impl: (...args: never[]) => unknown,
  isEntryFn = false,
): string {
  const source = impl.toString()

  // Extract parameter names from the arrow function
  const arrowMatch = source.match(/^\(([^)]*)\)\s*=>/)
  if (!arrowMatch) {
    throw new Error(`Could not parse arrow function params from: ${source}`)
  }
  const params = arrowMatch[1]! // e.g. "pos, _varInfo, P"

  // Find the function body: everything between => { and the final }
  const bodyStart = source.indexOf(
    '{',
    arrowMatch.index! + arrowMatch[0].length,
  )
  if (bodyStart === -1) {
    throw new Error(`Could not find function body in: ${source}`)
  }

  // Find matching closing brace from the start going forward
  let depth = 0
  let bodyEnd = -1
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') {
      depth++
    } else if (source[i] === '}') {
      depth--
      if (depth === 0) {
        bodyEnd = i
        break
      }
    }
  }

  let body = source.slice(bodyStart + 1, bodyEnd).trim()

  // typegpu 0.11 emits an entry fn's IO record as real named WGSL params, so
  // the body references them directly — no `let x = in.x;` shims (those now
  // collide with the generated params as redefinitions).

  // ---- Transform typegpu DSL to WGSL ----

  // Remove 'use gpu' directive
  body = body.replace(/['"]use gpu['"]\s*;?\s*/g, '')

  // Replace typegpu constant access. Dotted patterns (PI.$) are literal;
  // bare identifiers must match on word boundaries — a plain substring
  // replace of e.g. AM would corrupt CAMERA/GAMMA.
  for (const [pattern, value] of Object.entries(CONSTANTS)) {
    if (pattern.includes('.')) {
      body = body.replaceAll(pattern, value)
    } else {
      body = body.replace(new RegExp(`\\b${pattern}\\b`, 'g'), value)
    }
  }

  // Replace method calls: expr.method(arg) → expr op arg
  const methods: Record<string, string> = {
    mul: '*',
    div: '/',
    add: '+',
    sub: '-',
  }

  body = replaceMethodCalls(body, methods)
  body = replaceStandaloneMathFunctions(body)

  // Replace JS array literals [...] with WGSL array(...)
  body = body.replace(/(?<![a-zA-Z0-9_\]])\[([^\]]+)\]/g, 'array($1)')

  // Replace object literal return in vertex shaders with the output struct
  // constructor. `Out` is typegpu 0.11's magic name for a template entry fn's
  // generated output struct (it rewrites `Out(` to the real struct name).
  body = body.replace(
    /return\s*\{\s*pos\s*:\s*([\s\S]+?)\s*,\s*uv\s*:\s*([\s\S]+?)\s*\}[\s;]*/g,
    'return Out($1, $2);',
  )

  // Replace JS comparison operators
  body = body.replaceAll('===', '==')
  body = body.replaceAll('!==', '!=')

  // Replace JS 'let' with WGSL 'var' (unless it's a binding)
  body = body.replace(
    /\blet\s+([a-zA-Z0-9_]+)\s*=\s*([^;]+);/g,
    (match, name, expr) => {
      if (
        expr.includes('layout.$') ||
        expr.includes('bindGroupLayout.$') ||
        expr.includes('.$.')
      ) {
        return `let ${name} = ${expr};`
      }
      return `var ${name} = ${expr};`
    },
  )

  // Replace JS 'const' with WGSL 'let'
  // Use word boundaries to avoid replacing inside identifiers
  body = body.replace(/\bconst\b/g, 'let')

  // Comment out self-assignment declarations of layout slots (e.g. let uniforms = bindGroupLayout.$.uniforms; -> // bindGroupLayout.$.uniforms)
  body = body.replace(
    /\b(let|const|var)\s+([a-zA-Z0-9_]+)\s*=\s*([a-zA-Z0-9_]+)\.\$\.\2\s*;?/g,
    '// $3.$.$2',
  )

  // Return as valid WGSL function input for typegpu's extractArgs
  if (isEntryFn) {
    return `{\n${body}\n}`
  } else {
    return `(${params}) {\n${body}\n}`
  }
}

/**
 * Replace typegpu method calls (expr.method(arg)) with WGSL operators.
 * Properly handles nested parentheses in the receiver expression.
 */
function replaceMethodCalls(code: string, ops: Record<string, string>): string {
  let result = ''
  let i = 0

  while (i < code.length) {
    // Find the next dot that starts a method call
    let dotIdx = -1
    for (let j = i; j < code.length; j++) {
      if (code[j] === '.') {
        // Check if this dot starts one of our method calls
        for (const method of Object.keys(ops)) {
          const prefix = `.${method}(`
          if (code.startsWith(prefix, j)) {
            dotIdx = j
            break
          }
        }
        if (dotIdx !== -1) break
      }
    }

    if (dotIdx === -1) {
      result += code.slice(i)
      break
    }

    // Find which method this is
    let methodName = ''
    let op = ''
    for (const [method, o] of Object.entries(ops)) {
      if (code.startsWith(`.${method}(`, dotIdx)) {
        methodName = method
        op = o
        break
      }
    }

    // Find the matching closing paren
    const argStart = dotIdx + methodName.length + 2 // .method(
    let depth = 1
    let argEnd = argStart
    while (argEnd < code.length && depth > 0) {
      if (code[argEnd] === '(') depth++
      else if (code[argEnd] === ')') depth--
      argEnd++
    }
    const arg = code.slice(argStart, argEnd - 1)

    // Extract the receiver expression (everything from i to dotIdx)
    const receiver = code.slice(i, dotIdx)

    result += `${receiver} ${op} ${arg}`
    i = argEnd
  }

  return result
}

/**
 * Replace standalone typegpu math function calls (e.g. div(a, b), mul(a, b))
 * with WGSL operators (e.g. ((a) / (b)), ((a) * (b))). Handles nested calls.
 */
function replaceStandaloneMathFunctions(code: string): string {
  const fns = ['div', 'mul', 'add', 'sub']
  const ops: Record<string, string> = {
    div: '/',
    mul: '*',
    add: '+',
    sub: '-',
  }

  let changed = true
  while (changed) {
    changed = false
    for (const fn of fns) {
      const prefix = `${fn}(`
      let idx = code.indexOf(prefix)
      while (idx !== -1) {
        // Find the arguments of this function call.
        const start = idx + prefix.length
        let depth = 1
        let commaIdx = -1
        let end = start
        while (end < code.length && depth > 0) {
          if (code[end] === '(') {
            depth++
          } else if (code[end] === ')') {
            depth--
          } else if (code[end] === ',' && depth === 1) {
            commaIdx = end
          }
          end++
        }

        if (depth === 0 && commaIdx !== -1) {
          const arg1 = code.slice(start, commaIdx).trim()
          const arg2 = code.slice(commaIdx + 1, end - 1).trim()
          const op = ops[fn]!
          const replacement = `(${arg1} ${op} ${arg2})`
          code = code.slice(0, idx) + replacement + code.slice(end)
          changed = true
          // Restart search after replacing
          idx = code.indexOf(prefix, idx + replacement.length)
        } else {
          idx = code.indexOf(prefix, idx + 1)
        }
      }
    }
  }
  return code
}
