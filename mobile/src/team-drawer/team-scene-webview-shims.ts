// Why: the Pixel painter and the director call these, and an old Android System WebView or an
// iOS 15 WKWebView lacks them (toSorted: Chrome 110 / Safari 16). esbuild lowers syntax, not
// runtime APIs, so the engine installs these before the painter runs (as the xterm engine does).

export type TeamSceneEngineShimScope = {
  Array: ArrayConstructor
  Object: ObjectConstructor
  String: StringConstructor
}

type Replacer = (substring: string, ...args: unknown[]) => string

function toSorted<T>(this: T[], compare?: (a: T, b: T) => number): T[] {
  return this.slice().sort(compare)
}

function findLast<T>(
  this: T[],
  predicate: (value: T, index: number, array: T[]) => unknown,
  thisArg?: unknown
): T | undefined {
  for (let i = this.length - 1; i >= 0; i--) {
    if (predicate.call(thisArg, this[i]!, i, this)) {
      return this[i]
    }
  }
  return undefined
}

function findLastIndex<T>(
  this: T[],
  predicate: (value: T, index: number, array: T[]) => unknown,
  thisArg?: unknown
): number {
  for (let i = this.length - 1; i >= 0; i--) {
    if (predicate.call(thisArg, this[i]!, i, this)) {
      return i
    }
  }
  return -1
}

function at<T>(this: T[], index: number): T | undefined {
  const n = Math.trunc(index) || 0
  const i = n < 0 ? this.length + n : n
  return i < 0 || i >= this.length ? undefined : this[i]
}

// Why a descriptor: own, enumerable or not, as the native; and it throws on null like it.
function hasOwn(object: object, key: PropertyKey): boolean {
  return Object.getOwnPropertyDescriptor(object, key) !== undefined
}

// Why toString, not instanceof: a RegExp from another realm fails instanceof.
const isRegExp = (value: unknown): value is RegExp =>
  Object.prototype.toString.call(value) === '[object RegExp]'

function replaceAll(this: string, search: string | RegExp, replacement: string | Replacer): string {
  if (isRegExp(search) && !search.global) {
    throw new TypeError('replaceAll must be called with a global RegExp')
  }
  // Why through replace: it keeps the native's `$&`, `$$` and replacer-function handling.
  const pattern = isRegExp(search)
    ? search
    : new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  return typeof replacement === 'function'
    ? this.replace(pattern, replacement)
    : this.replace(pattern, replacement)
}

/** Installs each missing method as the native is (not enumerable); returns what it installed. */
export function installTeamSceneEngineShims(scope: TeamSceneEngineShimScope): string[] {
  const installed: string[] = []
  const fill = (owner: object, ownerName: string, name: string, value: unknown): void => {
    if (typeof Reflect.get(owner, name) === 'function') {
      return
    }
    Object.defineProperty(owner, name, {
      value,
      writable: true,
      configurable: true,
      enumerable: false
    })
    installed.push(`${ownerName}.${name}`)
  }
  fill(scope.Array.prototype, 'Array.prototype', 'toSorted', toSorted)
  fill(scope.Array.prototype, 'Array.prototype', 'findLast', findLast)
  fill(scope.Array.prototype, 'Array.prototype', 'findLastIndex', findLastIndex)
  fill(scope.Array.prototype, 'Array.prototype', 'at', at)
  fill(scope.Object, 'Object', 'hasOwn', hasOwn)
  fill(scope.String.prototype, 'String.prototype', 'replaceAll', replaceAll)
  return installed
}
