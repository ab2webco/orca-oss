import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildModuleSource,
  FONT_SOURCE_PATH,
  GENERATED_MODULE_PATH,
  verifyModule
} from './generate-panel-font-data-uri.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')

describe('panel font data URI generation', () => {
  it('embeds the exact bytes of the app font the renderer loads', async () => {
    const bytes = await readFile(path.join(REPO_ROOT, FONT_SOURCE_PATH))
    const source = await buildModuleSource()
    const encoded = /'data:font\/woff2;base64,([A-Za-z0-9+/=]+)'/.exec(source)?.[1]

    expect(encoded).toBeTruthy()
    expect(Buffer.from(encoded, 'base64').equals(bytes)).toBe(true)
  })

  it('keeps the committed module in sync with the font file', async () => {
    // Drift would silently ship a panel font that differs from the app's.
    await expect(verifyModule(await buildModuleSource())).resolves.toBeUndefined()
  })

  it('fails loudly when the committed module drifts', async () => {
    await expect(verifyModule('stale')).rejects.toThrow(GENERATED_MODULE_PATH)
  })
})
