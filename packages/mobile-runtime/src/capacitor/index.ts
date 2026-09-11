/**
 * The Capacitor adapter. Only the native build reaches this module, through
 * `if (IS_NATIVE) await import('@chaos-master/mobile-runtime/capacitor')`, so
 * the web bundle never contains the plugins.
 */
import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { saveFileWith, shareSavedWith } from '../files'
import type { FilePorts, SaveOptions, SaveOutcome, StorageArea } from '../files'

export type { SaveOptions, SaveOutcome } from '../files'

const DIRECTORY: Record<StorageArea, Directory> = {
  documents: Directory.Documents,
  cache: Directory.Cache,
}

const ports: FilePorts = {
  platform: Capacitor.getPlatform(),
  exists: (path, area) =>
    Filesystem.stat({ path, directory: DIRECTORY[area] }).then(
      () => true,
      () => false,
    ),
  write: async (path, area, data) => {
    const { uri } = await Filesystem.writeFile({
      path,
      data,
      directory: DIRECTORY[area],
      recursive: true,
    })
    return uri
  },
  append: (path, area, data) =>
    Filesystem.appendFile({ path, data, directory: DIRECTORY[area] }),
  share: async (uri, title) => {
    await Share.share({ title, files: [uri], dialogTitle: title })
  },
}

/** Android: Documents/<folder>, falling back to the share sheet. iOS: the share sheet. */
export const saveFile = (
  blob: Blob,
  fileName: string,
  options: SaveOptions,
): Promise<SaveOutcome> => saveFileWith(ports, blob, fileName, options)

/** Opens the share sheet for a file `saveFile` saved. */
export const shareSavedFile = (uri: string, title: string): Promise<void> =>
  shareSavedWith(ports, uri, title)
