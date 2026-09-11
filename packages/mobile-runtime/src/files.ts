/**
 * Saving a file the user asked for (a render, an export, a backup) from the
 * native app. A WebView ignores `<a download>`, so native builds hand the
 * bytes to the platform instead:
 *
 * - Android writes into the public Documents folder, under a folder named for
 *   the app, where the Files app and the gallery find it. From Android 11 on
 *   (the app's minSdk is 31) that needs no permission, but an app may only
 *   touch files it created, so a name an earlier install left behind is
 *   refused and the next free name is used.
 * - iOS has no shared folder an app can write into. It gets the share sheet,
 *   whose "Save to Files" and "Save Image" cover the same ground; so does
 *   Android when shared storage refuses the file.
 *
 * The platform sits behind `FilePorts`, so this runs in tests against fakes;
 * `./capacitor` binds the ports to Capacitor's Filesystem and Share plugins.
 */

export type StorageArea = 'documents' | 'cache'

export interface FilePorts {
  /** `Capacitor.getPlatform()`: 'android', 'ios' or 'web'. */
  readonly platform: string
  exists: (path: string, area: StorageArea) => Promise<boolean>
  /** Creates or truncates the file, and any missing folders; resolves its URI. */
  write: (path: string, area: StorageArea, base64: string) => Promise<string>
  append: (path: string, area: StorageArea, base64: string) => Promise<void>
  /** Opens the system share sheet for a file `write` created. */
  share: (uri: string, title: string) => Promise<void>
}

export type SaveOutcome =
  /** In shared storage; `location` is the folder as the Files app shows it. */
  | {
      readonly kind: 'saved'
      readonly location: string
      readonly fileName: string
      readonly uri: string
    }
  /** Handed to the share sheet, and the user picked a destination. */
  | { readonly kind: 'shared' }
  /** The user dismissed the share sheet. */
  | { readonly kind: 'cancelled' }

export interface SaveOptions {
  /** The folder inside Documents, e.g. the app's name. */
  readonly folder: string
}

/**
 * Bytes per bridge call. Capacitor passes plugin arguments as one JSON
 * string, so a 4K render or an MP4 sent whole can exhaust the WebView's
 * memory. A multiple of 3, so each chunk encodes to base64 without padding
 * and the native side decodes every chunk on its own.
 */
export const CHUNK_BYTES = 3 * 1024 * 1024

export async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  // fromCharCode takes the bytes as arguments; stay far below engine limits.
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }
  return btoa(binary)
}

async function writeBlob(
  ports: FilePorts,
  path: string,
  area: StorageArea,
  blob: Blob,
): Promise<string> {
  const uri = await ports.write(
    path,
    area,
    await base64Of(blob.slice(0, CHUNK_BYTES)),
  )
  for (let start = CHUNK_BYTES; start < blob.size; start += CHUNK_BYTES) {
    await ports.append(
      path,
      area,
      await base64Of(blob.slice(start, start + CHUNK_BYTES)),
    )
  }
  return uri
}

/** Reserved on Android and iOS file systems, plus both path separators. */
const RESERVED = '\\/:*?"<>|'
const MAX_BASE_LENGTH = 100

export function splitExtension(name: string): readonly [string, string] {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
}

/**
 * A name that stays one file in the target folder: separators, reserved and
 * control characters become '-', leading dots go (no hidden files), and the
 * base is capped well inside the 255-byte file name limit.
 */
export function safeFileName(name: string): string {
  const cleaned = Array.from(name, (ch) =>
    ch.charCodeAt(0) < 0x20 || RESERVED.includes(ch) ? '-' : ch,
  )
    .join('')
    .trim()
    .replace(/^\.+/, '')
  const [base, ext] = splitExtension(cleaned)
  const capped = base.slice(0, MAX_BASE_LENGTH).trim()
  return capped === '' ? `file${ext}` : `${capped}${ext}`
}

/**
 * The names to try, in order: the name itself, `name (2)` to `name (9)` the
 * way desktop browsers number a repeated download, then a timestamped name.
 */
export function candidateNames(fileName: string, now: Date): string[] {
  const [base, ext] = splitExtension(fileName)
  const numbered = Array.from(
    { length: 8 },
    (_, index) => `${base} (${index + 2})${ext}`,
  )
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  return [fileName, ...numbered, `${base} ${stamp}${ext}`]
}

/** Both platforms reject `Share.share` with "Share canceled" on dismissal. */
export function isShareCancel(error: unknown): boolean {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? error.message
      : error
  return typeof message === 'string' && /cancel/i.test(message)
}

async function saveToDocuments(
  ports: FilePorts,
  blob: Blob,
  fileName: string,
  folder: string,
  now: Date,
): Promise<SaveOutcome | null> {
  let refusals = 0
  for (const candidate of candidateNames(fileName, now)) {
    const path = `${folder}/${candidate}`
    if (await ports.exists(path, 'documents')) continue
    try {
      const uri = await writeBlob(ports, path, 'documents', blob)
      return {
        kind: 'saved',
        location: `Documents/${folder}`,
        fileName: candidate,
        uri,
      }
    } catch {
      // A file an earlier install created is invisible to `exists` but still
      // refuses the write. One refusal moves on to the next name; a second
      // means shared storage is not writable here at all.
      refusals += 1
      if (refusals === 2) return null
    }
  }
  return null
}

async function shareFromCache(
  ports: FilePorts,
  blob: Blob,
  fileName: string,
): Promise<SaveOutcome> {
  // A later share of the same name overwrites this copy, and the OS clears
  // the cache folder when it needs the space.
  const uri = await writeBlob(ports, `exports/${fileName}`, 'cache', blob)
  try {
    await ports.share(uri, fileName)
  } catch (error) {
    if (isShareCancel(error)) return { kind: 'cancelled' }
    throw error
  }
  return { kind: 'shared' }
}

export async function saveFileWith(
  ports: FilePorts,
  blob: Blob,
  fileName: string,
  options: SaveOptions,
  now: Date = new Date(),
): Promise<SaveOutcome> {
  const name = safeFileName(fileName)
  if (ports.platform === 'android') {
    const saved = await saveToDocuments(ports, blob, name, options.folder, now)
    if (saved !== null) return saved
  }
  return shareFromCache(ports, blob, name)
}

/**
 * The share sheet for a blob on either platform. The native stand-in for
 * copying an image: a WebView cannot put one on Android's clipboard (the
 * write resolves and the clipboard stays empty).
 */
export async function shareBlobWith(
  ports: FilePorts,
  blob: Blob,
  fileName: string,
): Promise<SaveOutcome> {
  return shareFromCache(ports, blob, safeFileName(fileName))
}

/** The "Share" on a saved file's toast; a dismissed sheet is not an error. */
export async function shareSavedWith(
  ports: FilePorts,
  uri: string,
  title: string,
): Promise<void> {
  try {
    await ports.share(uri, title)
  } catch (error) {
    if (!isShareCancel(error)) throw error
  }
}
