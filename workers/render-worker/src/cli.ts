import { renderFlameGPU } from './render.ts'
import { encodePNG } from './png.ts'
import { parseArgs } from 'jsr:@std/cli/parse-args'

const args = parseArgs(Deno.args, {
  string: ['flame', 'out', 'width', 'height', 'quality'],
})

const flamePath = args.flame
const outputPath = args.out
const width = parseInt(args.width ?? '1920')
const height = parseInt(args.height ?? '1080')
const quality = parseFloat(args.quality ?? '0.5')

if (!flamePath || !outputPath) {
  console.error(
    'Usage: deno run --unstable-webgpu ... src/cli.ts --flame <flame.json> --out <out.png> [--width <w>] [--height <h>] [--quality <q>]',
  )
  Deno.exit(1)
}

try {
  const flameJson = await Deno.readTextFile(flamePath)
  const flame = JSON.parse(flameJson)

  const result = await renderFlameGPU(
    flame,
    {
      width,
      height,
      quality,
    },
    (progress) => {
      // Write progress to stdout/stderr in a parsed format
      console.error(`PROGRESS:${progress}`)
    },
  )

  const png = await encodePNG(result.pixels, result.width, result.height)
  await Deno.writeFile(outputPath, png)
  console.error('SUCCESS')
  Deno.exit(0)
} catch (err) {
  console.error('ERROR:', err instanceof Error ? err.message : String(err))
  Deno.exit(1)
}
