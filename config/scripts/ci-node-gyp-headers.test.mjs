import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

const githubDir = resolve(import.meta.dirname, '../../.github')
const sharedAction = 'actions/use-external-node-gyp/action.yml'

describe('CI node-gyp setup', () => {
  it('installs node-gyp only through the shared action', () => {
    const inline = readdirSync(githubDir, { recursive: true })
      .filter((file) => /\.ya?ml$/.test(file) && file !== sharedAction)
      .flatMap((file) =>
        readFileSync(join(githubDir, file), 'utf8')
          .split('\n')
          .map((line, index) => ({ file, line: index + 1, text: line.trim() }))
          .filter(({ text }) => !text.startsWith('#') && /npm install -g node-gyp/.test(text))
      )
    expect(inline).toEqual([])
  })

  // Why: node-pty and cpu-features build in parallel and both downloaded the headers into one
  // cache dir; a half-written common.gypi failed the install with gyp "SyntaxError" (ORCA-1148).
  it('fetches the Node headers once before any native build runs', () => {
    const action = parse(readFileSync(join(githubDir, sharedAction), 'utf8'))
    const script = action.runs.steps.map((step) => step.run ?? '').join('\n')
    expect(script).toMatch(/npm install -g node-gyp@\d+\.\d+\.\d+/)
    expect(script).toContain('npm_config_node_gyp=')
    expect(script).toMatch(/node "\$node_gyp" install/)
  })
})
