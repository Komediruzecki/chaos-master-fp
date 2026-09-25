// Animate one persistent cloud; controller, hand and canvas rays share selection.
import { createSystem, Hovered, Mesh, MeshBasicMaterial, Pressed, RawShaderMaterial, } from '@iwsdk/core'
import { Flame } from './components'
import type { Entity } from '@iwsdk/core'

export const experience = {
  running: true,
  selected: false,
  selections: 0,
  elapsed: 0,
  ready: false,
}

export class FlameSystem extends createSystem({
  flames: { required: [Flame] },
  pressed: { required: [Flame, Pressed] },
  hovered: { required: [Flame, Hovered] },
}) {
  init() {
    const prepare = (entity: Entity) => {
      const cloud = entity.object3D?.getObjectByName('FlameCloud')
      const halo = entity.object3D?.getObjectByName('SelectionHalo')
      // The lightweight authored sphere owns hit testing, not 32K splats.
      if (cloud) cloud.raycast = () => {}
      if (halo) halo.raycast = () => {}
      experience.ready = true
    }
    // World.create may finish loading the authored scene before this system mounts.
    for (const entity of this.queries.flames.entities) prepare(entity)
    this.cleanupFuncs.push(this.queries.flames.subscribe('qualify', prepare))
    this.cleanupFuncs.push(
      this.queries.pressed.subscribe('qualify', (entity) => {
        const selected = !entity.getValue(Flame, 'selected')
        entity.setValue(Flame, 'selected', selected)
        experience.selected = selected
        experience.selections++
      }),
    )
  }

  update(delta: number) {
    const session = this.renderer.xr.getSession()
    const visible =
      !document.hidden && (!session || session.visibilityState === 'visible')
    if (visible && experience.running)
      experience.elapsed += Math.min(delta, 0.05)
    for (const entity of this.queries.flames.entities) {
      const cloud = entity.object3D?.getObjectByName('FlameCloud')
      const halo = entity.object3D?.getObjectByName('SelectionHalo')
      if (
        cloud instanceof Mesh &&
        cloud.material instanceof RawShaderMaterial
      ) {
        cloud.rotation.y = experience.elapsed * 0.08
        cloud.material.uniforms.time.value = experience.elapsed
        cloud.material.uniforms.selected.value = experience.selected ? 1 : 0
      }
      if (halo instanceof Mesh && halo.material instanceof MeshBasicMaterial) {
        halo.material.opacity = experience.selected
          ? 0.8
          : this.queries.hovered.entities.size
            ? 0.5
            : 0.2
        halo.material.color.setHex(experience.selected ? 0xe8b16b : 0x61bfa7)
      }
    }
  }
}
