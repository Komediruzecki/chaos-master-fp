// Observatory chrome reuses the application's SVG icon shapes through URL masks.
import book from '../../../../packages/app/src/icons/book.svg?url'
import check from '../../../../packages/app/src/icons/check.svg?url'
import down from '../../../../packages/app/src/icons/chevron-down.svg?url'
import left from '../../../../packages/app/src/icons/chevron-left.svg?url'
import right from '../../../../packages/app/src/icons/chevron-right.svg?url'
import close from '../../../../packages/app/src/icons/cross.svg?url'
import globe from '../../../../packages/app/src/icons/globe.svg?url'
import guide from '../../../../packages/app/src/icons/info.svg?url'
import minus from '../../../../packages/app/src/icons/minus.svg?url'
import music from '../../../../packages/app/src/icons/music-note.svg?url'
import pause from '../../../../packages/app/src/icons/pause.svg?url'
import play from '../../../../packages/app/src/icons/play-pause.svg?url'
import plus from '../../../../packages/app/src/icons/plus.svg?url'
import reset from '../../../../packages/app/src/icons/reset.svg?url'
import settings from '../../../../packages/app/src/icons/settings.svg?url'
import star from '../../../../packages/app/src/icons/star.svg?url'
import stop from '../../../../packages/app/src/icons/stop.svg?url'

const icons = {
  book,
  music,
  globe,
  play,
  pause,
  stop,
  check,
  star,
  left,
  right,
  up: down,
  down,
  plus,
  minus,
  reset,
  close,
  settings,
  guide,
}

export function Icon(props: { name: keyof typeof icons; class?: string }) {
  return (
    <span
      aria-hidden="true"
      class={`lx-icon ${props.class ?? ''}`}
      style={{
        '--lx-icon': `url("${icons[props.name]}")`,
        transform: props.name === 'up' ? 'rotate(180deg)' : undefined,
      }}
    />
  )
}

/** The app's Deep C geometry, using the two inks of the Almanac shell. */
export function LogoMark() {
  return (
    <svg
      class="lx-logo-mark"
      aria-hidden="true"
      viewBox="0 0 64 64"
      fill="none"
    >
      <path
        d="M 20.69 15.47 A 20.03 20.03 0 1 1 20.69 48.53"
        stroke="var(--lx-bone)"
        stroke-width="9.46"
      />
      <g fill="var(--lx-rubric)">
        <rect x="14.79" y="22.76" width="17.22" height="3.72" rx="1.86" />
        <rect x="14.79" y="30.14" width="13.05" height="3.72" rx="1.86" />
        <rect x="7.19" y="30.14" width="5.87" height="3.72" rx="1.86" />
        <rect x="17.40" y="37.52" width="14.61" height="3.72" rx="1.86" />
      </g>
    </svg>
  )
}
