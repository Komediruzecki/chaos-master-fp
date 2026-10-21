// Decorative page marks echo the three earned stars and four traced melody gems.
import { For, Show } from 'solid-js'

export function PageGlyph(props: {
  world: 'glasswake' | 'tideweave'
  earned: boolean
}) {
  return (
    <svg
      class="lx-page-glyph"
      data-world={props.world}
      data-earned={String(props.earned)}
      viewBox="0 0 200 64"
      aria-hidden="true"
    >
      <Show
        when={props.world === 'glasswake'}
        fallback={
          <>
            <For each={[18, 25, 32, 39, 46]}>
              {(y) => <path class="glyph-rule" d={`M12 ${y}H188`} />}
            </For>
            <path class="glyph-path" d="M26 48L76 38L126 13L176 23" />
            <For
              each={[
                [26, 48],
                [76, 38],
                [126, 13],
                [176, 23],
              ]}
            >
              {(point) => (
                <g transform={`translate(${point[0]} ${point[1]})`}>
                  <path class="glyph-form" d="M0 -7L6 0L0 7L-6 0Z" />
                  <path class="glyph-facet" d="M0 -7V7M-6 0H6" />
                </g>
              )}
            </For>
          </>
        }
      >
        <path
          class="glyph-path"
          d="M30 45Q100 15 170 45"
          stroke-dasharray="2 5"
        />
        <For
          each={[
            [40, 36],
            [100, 24],
            [160, 36],
          ]}
        >
          {(point) => (
            <g transform={`translate(${point[0]} ${point[1]})`}>
              <path
                class="glyph-form"
                d="M0 -15L4 -4L14 0L4 4L0 15L-4 4L-14 0L-4 -4Z"
              />
              <path class="glyph-facet" d="M0 -15V15M-14 0H14" />
            </g>
          )}
        </For>
      </Show>
    </svg>
  )
}
