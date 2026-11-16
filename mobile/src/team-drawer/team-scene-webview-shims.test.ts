import { createContext, runInContext, type Context } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  installTeamSceneEngineShims,
  type TeamSceneEngineShimScope
} from './team-scene-webview-shims'

const STRIP = `
  delete Array.prototype.toSorted
  delete Array.prototype.findLast
  delete Array.prototype.findLastIndex
  delete Array.prototype.at
  delete Object.hasOwn
  delete String.prototype.replaceAll
`

function realm(strip: boolean): { context: Context; scope: TeamSceneEngineShimScope } {
  const context = createContext({})
  if (strip) {
    runInContext(STRIP, context)
  }
  const scope: TeamSceneEngineShimScope = runInContext('({ Array, Object, String })', context)
  return { context, scope }
}

// Why JSON: values made in the other realm compare by content, not by prototype.
const run = (context: Context, code: string): unknown =>
  JSON.parse(runInContext(`JSON.stringify(${code})`, context))

describe('installTeamSceneEngineShims', () => {
  it('fills each missing method and they behave as the natives do', () => {
    const { context, scope } = realm(true)
    expect(installTeamSceneEngineShims(scope)).toEqual([
      'Array.prototype.toSorted',
      'Array.prototype.findLast',
      'Array.prototype.findLastIndex',
      'Array.prototype.at',
      'Object.hasOwn',
      'String.prototype.replaceAll'
    ])
    runInContext(
      'var xs = [3, 1, 2]; var sorted = xs.toSorted(); var desc = xs.toSorted((a, b) => b - a)',
      context
    )
    expect(run(context, '[xs, sorted, desc]')).toEqual([
      [3, 1, 2],
      [1, 2, 3],
      [3, 2, 1]
    ])
    expect(run(context, '[1, 2, 3, 4].findLast((x) => x % 2 === 1)')).toBe(3)
    expect(run(context, '[1, 2].findLast((x) => x > 5) === undefined')).toBe(true)
    expect(run(context, '[1, 2, 3, 4].findLastIndex((x) => x % 2 === 1)')).toBe(2)
    expect(run(context, '[1, 2].findLastIndex((x) => x > 5)')).toBe(-1)
    expect(
      run(
        context,
        '[[1, 2, 3].at(-1), [1, 2, 3].at(0), [1, 2, 3].at(1.7), [1].at(5) === undefined, [1].at(-2) === undefined]'
      )
    ).toEqual([3, 1, 2, true, true])
    expect(
      run(
        context,
        '[Object.hasOwn({ a: 1 }, "a"), Object.hasOwn({ a: 1 }, "toString"), Object.hasOwn(Object.defineProperty({}, "h", { value: 1 }), "h")]'
      )
    ).toEqual([true, false, true])
    expect(() => runInContext('Object.hasOwn(null, "a")', context)).toThrow(TypeError)
    expect(
      run(
        context,
        '["a.b.c".replaceAll(".", ""), "a/b".replaceAll("/", "\\\\"), "a$b$".replaceAll("$", "$$"), "aXbX".replaceAll(/x/gi, (m) => m.toLowerCase())]'
      )
    ).toEqual(['abc', 'a\\b', 'a$b$', 'axbx'])
    expect(() => runInContext('"ab".replaceAll(/a/, "")', context)).toThrow(TypeError)
  })

  it('adds them as the natives are: not enumerable, so for-in over an array stays its indexes', () => {
    const { context, scope } = realm(true)
    installTeamSceneEngineShims(scope)
    expect(
      run(context, '(() => { const keys = []; for (const k in [7]) keys.push(k); return keys })()')
    ).toEqual(['0'])
  })

  it('leaves methods the WebView already has untouched', () => {
    const { context, scope } = realm(false)
    const before = runInContext(
      '[Array.prototype.toSorted, Object.hasOwn, String.prototype.replaceAll]',
      context
    )
    expect(installTeamSceneEngineShims(scope)).toEqual([])
    const after = runInContext(
      '[Array.prototype.toSorted, Object.hasOwn, String.prototype.replaceAll]',
      context
    )
    expect(after[0]).toBe(before[0])
    expect(after[1]).toBe(before[1])
    expect(after[2]).toBe(before[2])
  })
})
