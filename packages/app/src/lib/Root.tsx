import { createEffect, createResource, Match, onCleanup, Switch, } from 'solid-js'
import { WebgpuNotSupported } from '@/components/ErrorHandling/ErrorHandling'
import { getWebgpuComponents } from '@/lib/WebgpuAdapter'
import { vramLog } from '@/utils/vramLog'
import { createShowDocumentation } from '../components/DocumentationModal/DocumentationModal'
import { RootContextProvider } from './RootContext'
import type { ParentProps } from 'solid-js'

type RootProps = {
  adapterOptions?: GPURequestAdapterOptions
}

function FallbackDocsButton() {
  const showDocs = createShowDocumentation()
  return (
    <button
      id="test-docs-button"
      style={{ display: 'none' }}
      onClick={showDocs}
    />
  )
}

export function Root(props: ParentProps<RootProps>) {
  const [webgpu] = createResource(
    () => ({
      adapterOptions: props.adapterOptions,
    }),
    async ({ adapterOptions }) => {
      onCleanup(() => {
        vramLog('[Root] Cleaning up Root context')
      })

      const { adapter, device, root } =
        await getWebgpuComponents(adapterOptions)

      vramLog('[Root] Acquired WebGPU components and TgpuRoot')
      return { adapter, device, root }
    },
  )

  createEffect(() => {
    const err = webgpu.error
    if (err) {
      console.error('[Root] WebGPU initialization failed:', err)
    }
  })

  return (
    <Switch>
      <Match when={webgpu.error}>
        <FallbackDocsButton />
        <WebgpuNotSupported />
      </Match>
      <Match when={webgpu()}>
        {(wg) => (
          <RootContextProvider value={wg()}>
            {props.children}
          </RootContextProvider>
        )}
      </Match>
    </Switch>
  )
}
