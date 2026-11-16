// Runs first in the Team scene WebView (scripts/build-team-scene-webview-engine.mjs): the painters
// call these, and esbuild lowers syntax but not runtime APIs, so an old WebView must still draw
// rather than throw. Each answers as the built-in does; team-scene-webview-engine.bundle.test.ts
// compares them.

type Test<T> = (value: T, index: number, all: readonly T[]) => unknown
type Replacer = (matched: string, position: number, whole: string) => unknown

function at<T>(this: readonly T[], index: number): T | undefined {
  const n = Math.trunc(index) || 0
  const k = n < 0 ? this.length + n : n
  return k < 0 || k >= this.length ? undefined : this[k]
}

function findLastIndex<T>(this: readonly T[], test: Test<T>, self?: unknown): number {
  for (let i = this.length - 1; i >= 0; i--) {
    if (test.call(self, this[i] as T, i, this)) {
      return i
    }
  }
  return -1
}

function findLast<T>(this: readonly T[], test: Test<T>, self?: unknown): T | undefined {
  for (let i = this.length - 1; i >= 0; i--) {
    if (test.call(self, this[i] as T, i, this)) {
      return this[i]
    }
  }
  return undefined
}

function toSorted<T>(this: readonly T[], compare?: (a: T, b: T) => number): T[] {
  if (compare !== undefined && typeof compare !== 'function') {
    throw new TypeError('The comparison function must be either a function or undefined')
  }
  return Array.from(this).sort(compare)
}

const hasOwn = (target: object, key: PropertyKey): boolean =>
  // oxlint-disable-next-line prefer-object-has-own -- this stands in for Object.hasOwn.
  Object.prototype.hasOwnProperty.call(target, key)

// Why no $1 or $<name>: a string search has no groups, so the built-in leaves them as written.
const substitute = (template: string, matched: string, at: number, whole: string): string =>
  template.replace(/\$([$&`'])/g, (_, sign: string) =>
    sign === '$'
      ? '$'
      : sign === '&'
        ? matched
        : sign === '`'
          ? whole.slice(0, at)
          : whole.slice(at + matched.length)
  )

function replaceAll(this: string, search: string | RegExp, replacement: string | Replacer): string {
  if (search instanceof RegExp) {
    if (!search.flags.includes('g')) {
      throw new TypeError('replaceAll must be called with a global RegExp')
    }
    return this.replace(search, replacement as string)
  }
  const whole = String(this)
  const needle = String(search)
  const step = Math.max(1, needle.length)
  let out = ''
  let end = 0
  for (
    let found = whole.indexOf(needle);
    found !== -1;
    found = found + step > whole.length ? -1 : whole.indexOf(needle, found + step)
  ) {
    const text =
      typeof replacement === 'function'
        ? String(replacement(needle, found, whole))
        : substitute(String(replacement), needle, found, whole)
    out += whole.slice(end, found) + text
    end = found + needle.length
  }
  return out + whole.slice(end)
}

// Why one radius for all four corners: the painters draw no other form.
function roundRect(
  this: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 0
): void {
  const r = Math.min(Math.abs(radius), Math.abs(w) / 2, Math.abs(h) / 2)
  this.moveTo(x + Math.sign(w) * r, y)
  this.arcTo(x + w, y, x + w, y + h, r)
  this.arcTo(x + w, y + h, x, y + h, r)
  this.arcTo(x, y + h, x, y, r)
  this.arcTo(x, y, x + w, y, r)
  this.closePath()
  this.moveTo(x, y)
}

const define = (owner: object | undefined, name: string, value: unknown): void => {
  if (owner && !(name in owner)) {
    Object.defineProperty(owner, name, { value, writable: true, configurable: true })
  }
}

/** Fills in what the WebView lacks, leaving every built-in it has untouched. */
export function installTeamSceneShims(): void {
  define(Array.prototype, 'at', at)
  define(Array.prototype, 'findLast', findLast)
  define(Array.prototype, 'findLastIndex', findLastIndex)
  define(Array.prototype, 'toSorted', toSorted)
  define(String.prototype, 'replaceAll', replaceAll)
  define(Object, 'hasOwn', hasOwn)
  define(globalThis.CanvasRenderingContext2D?.prototype, 'roundRect', roundRect)
}
