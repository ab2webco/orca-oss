// What orca-game-scene-captures.mjs shoots: its options and the scene captures per phase.
import { join, resolve } from 'node:path'

export const SCENE_PHASES = ['working', 'docs', 'build', 'verify', 'pr', 'handoff']

const COLUMNS = [130, 60]
const TIMES = [
  ['dawn', 6],
  ['day', 12],
  ['dusk', 18],
  ['night', 23]
]

/** `--out <dir>`, `--scene-file <json>` and `--phases <all|a,b>`; phases stay undefined when not passed. */
export const captureOptionsOf = (argv, root) => {
  const argOf = (name) => {
    const at = argv.indexOf(name)
    return at === -1 ? undefined : argv[at + 1]
  }
  const asked = argOf('--phases')
  const phases = asked === 'all' ? SCENE_PHASES : asked?.split(',').map((one) => one.trim())
  const unknown = phases?.find((one) => !SCENE_PHASES.includes(one))
  if (unknown !== undefined) {
    throw new Error(`Unknown phase "${unknown}"; use all or some of ${SCENE_PHASES.join(', ')}`)
  }
  return {
    out: resolve(argOf('--out') ?? join(root, 'out/orca-game-captures')),
    sceneFile: argOf('--scene-file'),
    phases
  }
}

/** A scene file is looked at in every phase by default; a built-in only in build, the costliest. */
export const scenePhasesOf = (phases, isFile) => phases ?? (isFile ? SCENE_PHASES : ['build'])

export const sceneShotsOf = (id, phases) =>
  phases.flatMap((phase) =>
    COLUMNS.flatMap((columns) => [
      { name: `${id}-${phase}-classic-${columns}`, phase, render: 'classic', columns },
      ...TIMES.map(([time, hour]) => ({
        name: `${id}-${phase}-hd-${time}-${columns}`,
        phase,
        render: 'hd',
        columns,
        hour
      }))
    ])
  )
