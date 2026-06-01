/**
 * Translate a math-notation expression (LaTeX-like) into a WGSL function body.
 * Returns the WGSL code and any errors encountered.
 */

interface TranslationResult {
  wgsl: string
  errors: string[]
}

type PatternReplacement = (match: string, ...groups: string[]) => string

interface Pattern {
  regex: RegExp
  replace: string | PatternReplacement
  description?: string
}

const PATTERNS: Pattern[] = [
  // Fractions: \frac{a}{b} → (a) / (b)
  {
    regex:
      /\\frac\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g,
    replace: (_m, num, den) => `((${num}) / (${den}))`,
    description: '\\frac{a}{b} → a / b',
  },
  // Square root: \sqrt{x} → sqrt(x)
  { regex: /\\sqrt\{([^}]+)\}/g, replace: (_m, inner) => `sqrt(${inner})` },
  // Absolute value: |x| or \lvert x \rvert → abs(x)
  { regex: /\|([^|]+)\|/g, replace: (_m, inner) => `abs(${inner})` },
  {
    regex: /\\lvert\s+([^|]+?)\s+\\rvert/g,
    replace: (_m, inner) => `abs(${inner})`,
  },
  // Trig functions
  { regex: /\\arcsinh\s*\{([^}]+)\}/g, replace: (_m, x) => `asinh(${x})` },
  { regex: /\\arccosh\s*\{([^}]+)\}/g, replace: (_m, x) => `acosh(${x})` },
  { regex: /\\arctanh\s*\{([^}]+)\}/g, replace: (_m, x) => `atanh(${x})` },
  { regex: /\\arcsin\s*\{([^}]+)\}/g, replace: (_m, x) => `asin(${x})` },
  { regex: /\\arccos\s*\{([^}]+)\}/g, replace: (_m, x) => `acos(${x})` },
  {
    regex: /\\arctan2\s*\{([^}]+)\}\s*\{([^}]+)\}/g,
    replace: (_m, y, x) => `atan2(${y}, ${x})`,
  },
  { regex: /\\arctan\s*\{([^}]+)\}/g, replace: (_m, x) => `atan(${x})` },
  { regex: /\\sinh\s*\{([^}]+)\}/g, replace: (_m, x) => `sinh(${x})` },
  { regex: /\\cosh\s*\{([^}]+)\}/g, replace: (_m, x) => `cosh(${x})` },
  { regex: /\\tanh\s*\{([^}]+)\}/g, replace: (_m, x) => `tanh(${x})` },
  { regex: /\\sin\s*\{([^}]+)\}/g, replace: (_m, x) => `sin(${x})` },
  { regex: /\\cos\s*\{([^}]+)\}/g, replace: (_m, x) => `cos(${x})` },
  { regex: /\\tan\s*\{([^}]+)\}/g, replace: (_m, x) => `tan(${x})` },
  // Trig functions with parens: \sin(x) → sin(x)
  { regex: /\\arcsinh\(/g, replace: 'asinh(' },
  { regex: /\\arccosh\(/g, replace: 'acosh(' },
  { regex: /\\arctanh\(/g, replace: 'atanh(' },
  { regex: /\\arcsin\(/g, replace: 'asin(' },
  { regex: /\\arccos\(/g, replace: 'acos(' },
  { regex: /\\arctan2\(/g, replace: 'atan2(' },
  { regex: /\\arctan\(/g, replace: 'atan(' },
  { regex: /\\sinh\(/g, replace: 'sinh(' },
  { regex: /\\cosh\(/g, replace: 'cosh(' },
  { regex: /\\tanh\(/g, replace: 'tanh(' },
  { regex: /\\sin\(/g, replace: 'sin(' },
  { regex: /\\cos\(/g, replace: 'cos(' },
  { regex: /\\tan\(/g, replace: 'tan(' },
  // Other math functions
  { regex: /\\ln\s*\{([^}]+)\}/g, replace: (_m, x) => `log(${x})` },
  { regex: /\\ln\(/g, replace: 'log(' },
  { regex: /\\log\s*\{([^}]+)\}/g, replace: (_m, x) => `log2(${x})` },
  { regex: /\\exp\s*\{([^}]+)\}/g, replace: (_m, x) => `exp(${x})` },
  { regex: /\\exp\(/g, replace: 'exp(' },
  { regex: /\\floor\s*\{([^}]+)\}/g, replace: (_m, x) => `floor(${x})` },
  { regex: /\\floor\(/g, replace: 'floor(' },
  { regex: /\\ceil\s*\{([^}]+)\}/g, replace: (_m, x) => `ceil(${x})` },
  { regex: /\\ceil\(/g, replace: 'ceil(' },
  {
    regex: /\\min\s*\{([^}]+)\}\s*\{([^}]+)\}/g,
    replace: (_m, a, b) => `min(${a}, ${b})`,
  },
  {
    regex: /\\max\s*\{([^}]+)\}\s*\{([^}]+)\}/g,
    replace: (_m, a, b) => `max(${a}, ${b})`,
  },
  { regex: /\\min\(/g, replace: 'min(' },
  { regex: /\\max\(/g, replace: 'max(' },
  {
    regex: /\\clamp\s*\{([^}]+)\}\s*\{([^}]+)\}\s*\{([^}]+)\}/g,
    replace: (_m, x, lo, hi) => `clamp(${x}, ${lo}, ${hi})`,
  },
  { regex: /\\clamp\(/g, replace: 'clamp(' },
  {
    regex: /\\mix\s*\{([^}]+)\}\s*\{([^}]+)\}\s*\{([^}]+)\}/g,
    replace: (_m, a, b, t) => `mix(${a}, ${b}, ${t})`,
  },
  { regex: /\\mix\(/g, replace: 'mix(' },
  {
    regex: /\\step\s*\{([^}]+)\}\s*\{([^}]+)\}/g,
    replace: (_m, edge, x) => `step(${edge}, ${x})`,
  },
  { regex: /\\step\(/g, replace: 'step(' },
  {
    regex: /\\smoothstep\s*\{([^}]+)\}\s*\{([^}]+)\}\s*\{([^}]+)\}/g,
    replace: (_m, lo, hi, x) => `smoothstep(${lo}, ${hi}, ${x})`,
  },
  { regex: /\\smoothstep\(/g, replace: 'smoothstep(' },
  {
    regex: /\\mod\s*\{([^}]+)\}\s*\{([^}]+)\}/g,
    replace: (_m, a, b) => `mod(${a}, ${b})`,
  },
  { regex: /\\mod\(/g, replace: 'mod(' },
  // Constants
  { regex: /\\pi\b/g, replace: '3.14159265' },
  // Special variables
  { regex: /\\theta\b/g, replace: 'atan2(pos.y, pos.x)' },
  { regex: /\bp_x\b/g, replace: 'pos.x' },
  { regex: /\bp_y\b/g, replace: 'pos.y' },
  {
    regex: /\br\b(?!\w)/g,
    replace: 'length(pos)',
    description: 'r → length(pos) — radial distance',
  },
  {
    regex: /\bw\b(?!\w)/g,
    replace: 'varInfo.weight',
    description: 'w → varInfo.weight',
  },
  // Operators
  { regex: /\\cdot\b/g, replace: '*' },
  { regex: /\\times\b/g, replace: '*' },
  { regex: /\\leq\b/g, replace: '<=' },
  { regex: /\\geq\b/g, replace: '>=' },
  { regex: /\\neq\b/g, replace: '!=' },
  // Power: x^2 → x * x (simple integer exponents only)
  {
    regex: /(\w+|\))\^(\d+)/g,
    replace: (_m, base, expStr) => {
      const exp = parseInt(expStr, 10)
      if (exp === 0) return '1.0'
      if (exp === 1) return base
      return Array(exp).fill(`(${base})`).join(' * ')
    },
    description: 'x^n → x * x * ... (n times)',
  },
  // Subscripts in variable names: p_x → p_x (already handled by p_x→pos.x, general case: just keep)
]

/**
 * Translate math notation to WGSL function body.
 */
export function mathToWgsl(input: string): TranslationResult {
  const errors: string[] = []

  if (!input.trim()) {
    return { wgsl: '', errors }
  }

  // Process each line as a separate assignment/expression
  const lines = input.split('\n')
  const wgslLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (raw === undefined) continue

    let line = raw.trim()
    if (!line) {
      wgslLines.push('')
      continue
    }

    // Apply pattern replacements sequentially
    for (const pattern of PATTERNS) {
      try {
        line = line.replace(pattern.regex, pattern.replace as string)
      } catch {
        errors.push(
          `Line ${i + 1}: failed to apply pattern "${pattern.description ?? pattern.regex.source}"`,
        )
      }
    }

    // Convert to WGSL variable declaration or assignment
    // If it looks like an assignment (contains =), prefix with "let"
    if (line.includes('=')) {
      const eqIdx = line.indexOf('=')
      const lhs = line.slice(0, eqIdx).trim()
      const rhs = line.slice(eqIdx + 1).trim()
      // If lhs is a simple variable name without let/var, add "let"
      if (/^[a-zA-Z_]\w*$/.test(lhs)) {
        line = `let ${lhs} = ${rhs};`
      } else if (lhs.startsWith('let ') || lhs.startsWith('var ')) {
        line = `${lhs} = ${rhs};`
      } else {
        line = `${line};`
      }
    } else {
      // Simple expression — assume it's a return
      line = `return ${line};`
    }

    wgslLines.push(`  ${line}`)
  }

  return { wgsl: wgslLines.join('\n'), errors }
}

/**
 * Heuristic to detect if text looks like math notation.
 * Returns true if the input contains LaTeX commands or math-style syntax.
 */
export function isMathNotation(text: string): boolean {
  if (!text.trim()) return false
  // Contains LaTeX commands
  if (/\\[a-zA-Z]+/.test(text)) return true
  // Contains math-specific patterns
  if (/\^/.test(text) && !text.includes('//')) return true
  return false
}
