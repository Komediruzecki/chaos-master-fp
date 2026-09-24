/** A deterministic, static star field; repaints only when the atlas resizes. */
import { onCleanup, onMount } from 'solid-js'

export function AtlasStars(props: { class?: string }) {
  let canvas: HTMLCanvasElement | undefined
  onMount(() => {
    const element = canvas
    if (!element) return
    const paint = () => {
      const { width, height } = element.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      element.width = Math.round(width * ratio)
      element.height = Math.round(height * ratio)
      const ctx = element.getContext('2d')
      if (!ctx) return
      ctx.scale(ratio, ratio)
      let seed = 1841
      const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return seed / 4294967296
      }
      const count = Math.min(500, Math.round((width * height) / 2000))
      for (let i = 0; i < count; i++) {
        const x = random() * width
        const y = random() * height
        const r = 0.3 + random() * 0.85
        const opacity = 0.15 + random() * 0.48
        ctx.fillStyle = `rgba(184, 211, 226, ${opacity})`
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    const observer = new ResizeObserver(paint)
    observer.observe(element)
    paint()
    onCleanup(() => {
      observer.disconnect()
    })
  })
  return <canvas ref={canvas} class={props.class} aria-hidden="true" />
}
