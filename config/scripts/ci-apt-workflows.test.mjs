import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const githubDir = resolve(import.meta.dirname, '../../.github')

describe('CI apt call sites', () => {
  it('routes every workflow and composite-action apt call through the bounded wrapper', () => {
    const unbounded = readdirSync(githubDir, { recursive: true })
      .filter((file) => /\.ya?ml$/.test(file))
      .flatMap((file) =>
        readFileSync(join(githubDir, file), 'utf8')
          .split('\n')
          .map((line, index) => ({ file, line: index + 1, text: line.trim() }))
          .filter(
            ({ text }) => !text.startsWith('#') && /\bapt-get\s+(update|install)\b/.test(text)
          )
      )
    expect(unbounded).toEqual([])
  })
})
