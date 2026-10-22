// The world's musical seal bridges a masked camera cut without trapping navigation.
import './passage.css'
import { createMemo } from 'solid-js'
import { Icon } from '../theme/Icon'
import type { PassageSnapshot } from './passage'

export function PassageThreshold(props: {
  passage: PassageSnapshot | undefined
}) {
  const place = createMemo(() => {
    const target = props.passage?.target
    if (target?.view === 'temple') return 'Temple threshold'
    if (target?.view === 'overview') return 'Observatory'
    return target?.worldId === 'tideweave' ? 'Tideweave' : 'Glasswake'
  })
  return (
    <>
      <div
        class="observatory-passage"
        aria-hidden="true"
        hidden={!props.passage?.active}
        data-destination={props.passage?.target.view}
        data-ink={props.passage?.target.worldId}
        style={{ opacity: props.passage?.opacity ?? 0 }}
      >
        <div class="observatory-passage-seal">
          <i />
          <i />
          <i />
          <span class="observatory-passage-notes">
            <Icon name="star" />
            <Icon name="music" />
          </span>
        </div>
        <span class="observatory-passage-name">{place()}</span>
      </div>
      <span class="lx-sr-only" role="status">
        {props.passage?.active ? `Entering ${place()}.` : ''}
      </span>
    </>
  )
}
