import { createResource, Show } from 'solid-js'
import { encodeSharePayload } from '@/utils/jsonQueryParam'
import type { FlameDescriptor } from '@/flame/schema/flameSchema'

/**
 * Hover-revealed "open this flame in the app" button. Encodes the flame into the
 * app's self-contained share link (`?flame=<encoded>`, never expires) using the
 * app's own encoder, against the APP origin (shareLink defaults to the current
 * origin, which here would be the landing domain). Encoding runs client-side.
 */
const APP_ORIGIN = 'https://chaos-master.com'

export default function OpenInApp(props: { flame: FlameDescriptor }) {
  const [url] = createResource(
    () => props.flame,
    async (flame) => `${APP_ORIGIN}/?flame=${await encodeSharePayload(flame)}`,
  )

  return (
    <Show when={url()}>
      <a
        class="open-in-app"
        href={url()}
        target="_blank"
        rel="noopener"
        title="Open this flame in Chaos Master"
        aria-label="Open this flame in Chaos Master"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M14 4h6v6" />
          <path d="M20 4l-8.5 8.5" />
          <path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />
        </svg>
      </a>
    </Show>
  )
}
