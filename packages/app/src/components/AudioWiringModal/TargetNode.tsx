import type { FlameTarget, TransformInfo } from '../../utils/audioAnalysis'
import { flameTargetKey } from '../../utils/audioAnalysis'
import styles from './AudioWiringModal.module.css'

export type TargetGroupData = {
  label: string
  kind: string
  targets: TargetNodeData[]
}

export type TargetNodeData = {
  target: FlameTarget
  label: string
  paramLabel: string
}

export function buildTargetGroups(
  transforms: TransformInfo[],
): TargetGroupData[] {
  const groups: TargetGroupData[] = [
    {
      label: 'Render Settings',
      kind: 'render',
      targets: (
        [
          'vibrancy',
          'exposure',
          'palettePhase',
          'paletteSpeed',
          'contrast',
          'gamma',
          'highlightPower',
          'lightPower',
          'depthColorPower',
          'zoom',
          'skipIters',
        ] as const
      ).map((param) => ({
        target: { kind: 'renderSetting' as const, param },
        label: `Render / ${param}`,
        paramLabel: param,
      })),
    },
  ]

  // Final affine group
  const finalAffineParams = ['a', 'b', 'c', 'd', 'e', 'f'] as const
  groups.push({
    label: 'Final Transform',
    kind: 'finalAffine',
    targets: finalAffineParams.map((param) => ({
      target: { kind: 'finalAffine' as const, param },
      label: `Final / ${param}`,
      paramLabel: param,
    })),
  })

  // Per-transform groups
  for (const tx of transforms) {
    const txTargets: TargetNodeData[] = []

    // Affine matrices
    for (const matrix of ['preAffine', 'postAffine'] as const) {
      for (const param of ['a', 'b', 'c', 'd', 'e', 'f'] as const) {
        txTargets.push({
          target: {
            kind: 'transformAffine' as const,
            transformIdx: tx.index,
            matrix,
            param,
          },
          label: `${tx.label} / ${matrix} / ${param}`,
          paramLabel: `${matrix === 'preAffine' ? 'Pre' : 'Post'}.${param}`,
        })
      }
    }

    // Transform properties
    const props = ['probability', 'colorX', 'colorY', 'colorSpeed'] as const
    for (const prop of props) {
      txTargets.push({
        target: {
          kind: 'transformProperty' as const,
          transformIdx: tx.index,
          property: prop,
        },
        label: `${tx.label} / ${prop}`,
        paramLabel: prop,
      })
    }

    // Variation weights
    for (const v of tx.variations) {
      txTargets.push({
        target: {
          kind: 'variationWeight' as const,
          transformIdx: tx.index,
          variationType: v.type,
        },
        label: `${tx.label} / ${v.type} weight`,
        paramLabel: v.type,
      })
    }

    groups.push({
      label: tx.label,
      kind: `tx-${tx.index}`,
      targets: txTargets,
    })
  }

  return groups
}

/** Full-width target cell used for properties and variations. */
export function TargetCell(props: {
  node: TargetNodeData
  isConnecting: boolean
  isTargetOfSelectedWire: boolean
  connectedSourceLabel?: string
  onCompleteConnection: (target: FlameTarget) => void
}) {
  const key = flameTargetKey(props.node.target)

  return (
    <div
      class={styles.targetCell}
      classList={{
        [styles.targetCellConnected as string]: !!props.connectedSourceLabel,
      }}
    >
      <div
        class={styles.targetPort}
        classList={{
          [styles.targetPortConnecting as string]: props.isConnecting,
          [styles.targetPortActive as string]: props.isTargetOfSelectedWire,
        }}
        role="button"
        tabIndex={0}
        aria-label={`Connect to ${props.node.label}`}
        data-target-port={key}
        onClick={() => props.onCompleteConnection(props.node.target)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            props.onCompleteConnection(props.node.target)
          }
        }}
      />
      <span class={styles.targetArrow}>→</span>
      <span
        class={styles.targetName}
        classList={{
          [styles.targetNameConnected as string]: !!props.connectedSourceLabel,
        }}
      >
        {props.node.paramLabel}
      </span>
      {props.connectedSourceLabel && (
        <span class={styles.targetSourceBadge}>
          {props.connectedSourceLabel}
        </span>
      )}
    </div>
  )
}

/** Compact cell for affine coefficients (used in the affine sub-grid). */
export function AffineCell(props: {
  label: string
  target: FlameTarget
  isConnecting: boolean
  isTargetOfSelectedWire: boolean
  connectedSourceLabel?: string
  onCompleteConnection: (target: FlameTarget) => void
}) {
  const key = flameTargetKey(props.target)

  return (
    <div
      class={styles.affineCell}
      classList={{
        [styles.affineCellConnected as string]: !!props.connectedSourceLabel,
      }}
    >
      <div
        class={styles.affineCellPort}
        classList={{
          [styles.targetPortConnecting as string]: props.isConnecting,
          [styles.targetPortActive as string]: props.isTargetOfSelectedWire,
        }}
        role="button"
        tabIndex={0}
        aria-label={`Connect to ${props.label}`}
        data-target-port={key}
        onClick={() => props.onCompleteConnection(props.target)}
      />
      <span class={styles.affineCellLabel}>{props.label}</span>
      {props.connectedSourceLabel && (
        <span class={styles.affineCellBadge}>{props.connectedSourceLabel}</span>
      )}
    </div>
  )
}
