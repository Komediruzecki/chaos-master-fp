import { marked } from 'marked'

type AdmonitionType = 'note' | 'info' | 'warn' | 'tip' | 'danger'

const ADMONITION_LABELS: Record<AdmonitionType, string> = {
  note: 'Note',
  info: 'Info',
  warn: 'Warning',
  tip: 'Tip',
  danger: 'Danger',
}

const ADMONITION_RE = /^:::(note|info|warn|tip|danger)\s*\n([\s\S]*?)^:::/gm

function sanitize(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
}

export function renderMarkdown(text: string): string {
  const admonitions: Array<{ type: AdmonitionType; content: string }> = []
  let placeholderIndex = 0

  // Extract admonition blocks and replace with placeholders
  const processed = text.replace(
    ADMONITION_RE,
    (_full, type: string, content: string) => {
      const idx = placeholderIndex++
      admonitions.push({
        type: type as AdmonitionType,
        content: content.trim(),
      })
      return `\n<!-- ADMONITION_${idx} -->\n`
    },
  )

  let html = marked.parse(processed, { async: false })

  // Restore admonitions with styled divs
  for (let i = 0; i < admonitions.length; i++) {
    const { type, content } = admonitions[i]!
    const renderedContent = marked.parse(content, { async: false })
    const label = ADMONITION_LABELS[type]
    html = html.replace(
      `<!-- ADMONITION_${i} -->`,
      `<div class="admonition admonition${type.charAt(0).toUpperCase() + type.slice(1)}"><div class="admonitionHeader">${label}</div><div class="admonitionContent">${renderedContent}</div></div>`,
    )
  }

  return sanitize(html)
}
