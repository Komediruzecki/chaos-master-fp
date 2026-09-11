/**
 * Global JSX type declarations for Deno server-side type-checking.
 *
 * Deno's jsxImportSource resolver needs the JSX namespace to be visible
 * when checking .tsx files. This provides minimal DOM element types.
 */

declare global {
  namespace JSX {
    interface IntrinsicElements {
      div: Record<string, unknown>
      span: Record<string, unknown>
      input: Record<string, unknown>
      button: Record<string, unknown>
      label: Record<string, unknown>
      select: Record<string, unknown>
      option: Record<string, unknown>
      textarea: Record<string, unknown>
      a: Record<string, unknown>
      img: Record<string, unknown>
      svg: Record<string, unknown>
      path: Record<string, unknown>
      circle: Record<string, unknown>
      line: Record<string, unknown>
      g: Record<string, unknown>
      canvas: Record<string, unknown>
      h1: Record<string, unknown>
      h2: Record<string, unknown>
      h3: Record<string, unknown>
      p: Record<string, unknown>
      ul: Record<string, unknown>
      li: Record<string, unknown>
      section: Record<string, unknown>
      header: Record<string, unknown>
      footer: Record<string, unknown>
      main: Record<string, unknown>
      nav: Record<string, unknown>
      form: Record<string, unknown>
      table: Record<string, unknown>
      tr: Record<string, unknown>
      td: Record<string, unknown>
      th: Record<string, unknown>
      thead: Record<string, unknown>
      tbody: Record<string, unknown>
      style: Record<string, unknown>
      template: Record<string, unknown>
      [key: string]: Record<string, unknown>
    }
  }
}

export {}
