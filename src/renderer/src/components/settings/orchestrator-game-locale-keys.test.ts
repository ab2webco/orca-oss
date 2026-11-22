import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '../../i18n/locales/en.json'
import es from '../../i18n/locales/es.json'

// Why: ORCA-1112 left no key a game settings row stopped reading; this keeps it that way.
const GAME_FILES = /^(OrchestratorGame|GamePanel)/

const settingsSource = readdirSync(__dirname)
  .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
  .map((name) => readFileSync(join(__dirname, name), 'utf8'))
  .join('\n')

const gameKeysOf = (catalog: unknown): string[] => {
  const settings = (catalog as { auto: { components: { settings: Record<string, object> } } }).auto
    .components.settings
  return Object.entries(settings)
    .filter(([file]) => GAME_FILES.test(file))
    .flatMap(([file, keys]) =>
      Object.keys(keys).map((key) => `auto.components.settings.${file}.${key}`)
    )
}

describe('game settings locale keys', () => {
  it.each([
    ['en', en],
    ['es', es]
  ])('has no %s key that no settings code reads', (_name, catalog) => {
    expect(gameKeysOf(catalog).filter((key) => !settingsSource.includes(key))).toEqual([])
  })
})
