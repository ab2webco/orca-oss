import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import { describe, expect, it } from 'vitest'

// Why: main.css imports the root katex's CSS; a consumer on another katex emits markup that CSS
// no longer styles (0.18 prefixed its classes), and no other test renders math (ORCA-994).
const rootRequire = createRequire(import.meta.url)
const rootKatexPackageJson = rootRequire.resolve('katex/package.json')

function katexPackageJsonSeenBy(consumer: string): string {
  return createRequire(rootRequire.resolve(consumer)).resolve('katex/package.json')
}

function versionAt(packageJsonPath: string): string {
  return (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version: string }).version
}

// Math-atom classes KaTeX emits for semantics only; its CSS has no rule for them in any release.
const UNSTYLED_ATOM_CLASSES = new Set([
  'mord',
  'mop',
  'mbin',
  'mrel',
  'mopen',
  'mclose',
  'mpunct',
  'minner',
  'mtight'
])

const FORMULAS = [
  '$\\frac{a}{b} + \\sqrt{x^2 + y^2}$',
  '$$\n\\sum_{i=1}^{n} i = \\int_0^\\infty e^{-x}\\,dx\n$$',
  '$$\n\\begin{pmatrix}1 & 2 \\\\ 3 & 4\\end{pmatrix} \\hat{x} \\overrightarrow{AB}\n$$'
]

describe('katex version alignment', () => {
  it.each(['rehype-katex', '@tiptap/extension-mathematics', 'mermaid'])(
    '%s renders with the katex whose CSS main.css imports',
    (consumer) => {
      const seen = katexPackageJsonSeenBy(consumer)
      expect(
        { consumer, katex: versionAt(seen), dir: path.dirname(seen) },
        `${consumer} must not resolve its own katex`
      ).toEqual({
        consumer,
        katex: versionAt(rootKatexPackageJson),
        dir: path.dirname(rootKatexPackageJson)
      })
    }
  )

  it('styles every layout class the Markdown preview emits for math', () => {
    const css = readFileSync(rootRequire.resolve('katex/dist/katex.min.css'), 'utf8')
    const styled = new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1]))
    const html = renderToStaticMarkup(
      <Markdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {FORMULAS.join('\n\n')}
      </Markdown>
    )
    const emitted = new Set(
      [...html.matchAll(/class="([^"]*)"/g)].flatMap((match) => match[1].split(/\s+/))
    )

    expect(emitted.has('katex')).toBe(true)
    const unstyled = [...emitted].filter(
      (name) => !styled.has(name) && !UNSTYLED_ATOM_CLASSES.has(name)
    )
    expect(unstyled).toEqual([])
  })
})
