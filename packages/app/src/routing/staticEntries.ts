/**
 * The files a plain static host needs to serve the app's path routes.
 *
 * On Cloudflare the Worker routes /benchmarks, /explore and /arcade, but a host
 * that only serves files (the Deno Deploy PR previews) answers them with a
 * 404. So the build writes a file for each: a copy of index.html in each page
 * route's folder, and a redirect page for /arcade. Such a host redirects
 * /explore to /explore/, one folder down, where the copy's relative asset URLs
 * would miss; they climb out of the folder instead. The Vite plugin in
 * vite.config.ts emits the files; Cloudflare serves the same ones.
 */
import { BENCHMARKS_PATH, EXPLORER_PATH } from './appPath'

const PAGE_ROUTES = [BENCHMARKS_PATH, EXPLORER_PATH]

/**
 * index.html as served from a folder one level down. The build's asset base is
 * relative ('./'), so each `./x` becomes `../x`: from /explore/ that is /x
 * again, and from /explore, where `..` cannot climb above the root, it is too.
 */
export function nestedIndexHtml(html: string): string {
  return html.replace(/\b(src|href)=(["'])\.\//g, '$1=$2../')
}

/**
 * A page that sends the browser on to `target` at once. A static host cannot
 * redirect by itself; the link is for a browser that ignores the refresh.
 */
export function redirectPageHtml(target: string, title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="robots" content="noindex" />
    <meta http-equiv="refresh" content="0; url=${target}" />
    <title>${title}</title>
  </head>
  <body>
    <p><a href="${target}">${title}</a></p>
  </body>
</html>
`
}

/** Each file, keyed by its path in the build output, from the built index.html. */
export function staticEntryFiles(indexHtml: string): Record<string, string> {
  const page = nestedIndexHtml(indexHtml)
  const files: Record<string, string> = {}
  for (const route of PAGE_ROUTES) {
    files[`${route.slice(1)}/index.html`] = page
  }
  // The Arcade is a tab, routed by fragment (lib/activeTab.ts); the Worker
  // redirects /arcade to /#arcade.
  files['arcade/index.html'] = redirectPageHtml(
    '../#arcade',
    'Lumen Apeiron Arcade',
  )
  return files
}
