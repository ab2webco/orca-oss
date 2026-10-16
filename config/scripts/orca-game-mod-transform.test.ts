import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { transformWithOxc, type Plugin } from 'vite'
import { describe, expect, it } from 'vitest'
import {
  createOrcaGameModTransformPlugin,
  ORCA_GAME_MOD_TS
} from '../build-plugins/orca-game-mod-transform'

const SCENE = join(import.meta.dirname, '../../resources/claude-plugins/orca-game/hooks/scene.ts')

type Transform = (
  code: string,
  id: string
) => Promise<{ code: string } | null> | { code: string } | null

const transformOf = (plugin: Plugin): Transform => {
  const hook = plugin.transform
  const handler = typeof hook === 'function' ? hook : hook?.handler
  expect(handler).toBeTypeOf('function')
  return handler as unknown as Transform
}

describe('orca-game mod transform', () => {
  it("cannot go through React's automatic JSX runtime: the mod's tsconfig sets an `h` factory", async () => {
    await expect(
      transformWithOxc(readFileSync(SCENE, 'utf8'), SCENE, { jsx: { runtime: 'automatic' } })
    ).rejects.toThrow(/pragma/)
  })

  it("strips the mod's TypeScript without applying its JSX factory", async () => {
    const result = await transformOf(createOrcaGameModTransformPlugin())(
      readFileSync(SCENE, 'utf8'),
      SCENE
    )
    expect(result?.code).toContain('export const sceneGridOf')
    expect(result?.code).not.toMatch(/import type|: number\b/)
  })

  it('leaves every other file to the regular transform', async () => {
    const transform = transformOf(createOrcaGameModTransformPlugin())
    expect(await transform('export const a: number = 1', '/repo/src/renderer/src/a.ts')).toBeNull()
    expect(
      await transform('export {}', '/repo/resources/claude-plugins/orca-game/hooks/a.tsx')
    ).toBeNull()
  })

  it('matches the mod on every platform', () => {
    expect(
      ORCA_GAME_MOD_TS.test('C:\\repo\\resources\\claude-plugins\\orca-game\\hooks\\scene.ts')
    ).toBe(true)
    expect(
      ORCA_GAME_MOD_TS.test('/repo/resources/claude-plugins/orca-game/hooks/scene.ts?v=1')
    ).toBe(true)
  })
})
