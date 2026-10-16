import { transformWithOxc, type Plugin } from 'vite'

// Why: the orca-game mod's tsconfig sets a classic `h` JSX factory, which oxc refuses next to
// React's automatic runtime. Settings imports only the mod's plain .ts drawing modules.
export const ORCA_GAME_MOD_TS =
  /[\\/]resources[\\/]claude-plugins[\\/]orca-game[\\/][^?]*\.ts(\?|$)/

export function createOrcaGameModTransformPlugin(): Plugin {
  return {
    name: 'orca:game-mod-ts',
    enforce: 'pre',
    async transform(code, id) {
      if (!ORCA_GAME_MOD_TS.test(id)) {
        return null
      }
      const result = await transformWithOxc(code, id, { jsx: 'preserve' })
      return { code: result.code, map: result.map }
    }
  }
}
