/**
 * Sanitizer for a plugin-supplied panel icon.
 *
 * Un SVG es codigo: llega desde la carpeta de un plugin de terceros y termina
 * dentro del chrome del host. Por eso NO se pasa markup al renderer — se parsea
 * aca a un arbol tipado con lista blanca de etiquetas y atributos, y el
 * renderer solo puede pintar lo que este tipo permite. Nada de innerHTML, nada
 * de `<script>`/`<foreignObject>`/`on*`/`href`/`<image>`: no existen en la
 * salida porque no existen en el tipo.
 */

/** Shapes and grouping only; anything that can load, script or reference
 *  external content is absent by construction. */
const ALLOWED_TAGS = [
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'rect'
] as const

export type PluginPanelIconSvgTag = (typeof ALLOWED_TAGS)[number]

const ALLOWED_TAG_SET: ReadonlySet<string> = new Set(ALLOWED_TAGS)

/** Geometry + presentation. No `id`/`class` (collide across icons rendered in
 *  one document), no `style` (a CSS parser is a second attack surface). */
const ALLOWED_ATTRIBUTES: ReadonlySet<string> = new Set([
  'd',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'points',
  'width',
  'height',
  'transform',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'fill-rule',
  'clip-rule',
  'opacity',
  'fill-opacity',
  'stroke-opacity'
])

/** Attributes only meaningful on the root element. */
const ROOT_ONLY_ATTRIBUTES: ReadonlySet<string> = new Set(['viewBox'])

/** A 32 KB icon can still encode a tree bomb, so the shape is bounded too. */
export const PLUGIN_PANEL_ICON_SVG_MAX_BYTES = 32 * 1024
const MAX_NODES = 512
const MAX_DEPTH = 16
const MAX_ATTRIBUTE_LENGTH = 4096

export type PluginPanelIconSvgNode = {
  tag: PluginPanelIconSvgTag
  attributes: Record<string, string>
  children: PluginPanelIconSvgNode[]
}

const VIEW_BOX_RE = /^-?\d+(?:\.\d+)?(?:[ ,]+-?\d+(?:\.\d+)?){3}$/

/**
 * Returns the sanitized root `<svg>` node, or `null` when the file is not a
 * usable icon. Callers fall back to the default icon on `null` — un plugin
 * jamas puede romper la barra con un archivo malo.
 */
export function sanitizePluginPanelIconSvg(raw: string): PluginPanelIconSvgNode | null {
  try {
    const root = parseElement(raw)
    if (!root || root.tag !== 'svg') {
      return null
    }
    const viewBox = root.attributes.viewBox
    if (!viewBox || !VIEW_BOX_RE.test(viewBox)) {
      return null
    }
    // El mismo icono se pinta a tamanos distintos en las tres superficies, asi
    // que el alto/ancho del archivo estorba: escala por CSS sobre el viewBox.
    delete root.attributes.width
    delete root.attributes.height
    // Sin `fill` un SVG pinta negro por defecto y desaparece en tema oscuro;
    // heredar `currentColor` desde la raiz es lo que lo ata al tema.
    root.attributes.fill ??= 'currentColor'
    return root
  } catch {
    return null
  }
}

type ParserState = { source: string; index: number; nodes: number }

function parseElement(source: string): PluginPanelIconSvgNode | null {
  const state: ParserState = { source, index: 0, nodes: 0 }
  skipProlog(state)
  const root = readNode(state, 0)
  return root
}

const XML_DECLARATION_RE = /^<\?xml[\s?]/

/** Comments and the XML declaration are skipped — every design tool emits them
 *  and neither can carry executable content. DOCTYPE, CDATA and any other
 *  processing instruction (`<?xml-stylesheet ?>`) are refused rather than
 *  half-understood. */
function skipProlog(state: ParserState): void {
  for (;;) {
    skipWhitespace(state)
    const rest = state.source.slice(state.index)
    if (rest.startsWith('<!--')) {
      const end = state.source.indexOf('-->', state.index + 4)
      if (end === -1) {
        throw new Error('unterminated comment')
      }
      state.index = end + 3
      continue
    }
    if (XML_DECLARATION_RE.test(rest)) {
      const end = state.source.indexOf('?>', state.index + 5)
      if (end === -1) {
        throw new Error('unterminated xml declaration')
      }
      state.index = end + 2
      continue
    }
    if (rest.startsWith('<!') || rest.startsWith('<?')) {
      throw new Error('doctype, CDATA and processing instructions are not allowed')
    }
    return
  }
}

function skipWhitespace(state: ParserState): void {
  while (state.index < state.source.length && /\s/.test(state.source[state.index]!)) {
    state.index += 1
  }
}

function readNode(state: ParserState, depth: number): PluginPanelIconSvgNode | null {
  if (depth > MAX_DEPTH) {
    throw new Error('icon nests too deeply')
  }
  state.nodes += 1
  if (state.nodes > MAX_NODES) {
    throw new Error('icon has too many nodes')
  }
  if (state.source[state.index] !== '<') {
    throw new Error('expected an element')
  }
  state.index += 1
  const tag = readName(state)
  if (!ALLOWED_TAG_SET.has(tag)) {
    throw new Error(`element <${tag}> is not allowed`)
  }
  const { attributes, selfClosing } = readAttributes(state, tag === 'svg')
  const node: PluginPanelIconSvgNode = {
    tag: tag as PluginPanelIconSvgTag,
    attributes,
    children: []
  }
  if (selfClosing) {
    return node
  }
  for (;;) {
    skipText(state)
    const rest = state.source.slice(state.index)
    if (rest.startsWith('<!--')) {
      const end = state.source.indexOf('-->', state.index + 4)
      if (end === -1) {
        throw new Error('unterminated comment')
      }
      state.index = end + 3
      continue
    }
    if (rest.startsWith('<!') || rest.startsWith('<?')) {
      throw new Error('doctype, CDATA and processing instructions are not allowed')
    }
    if (rest.startsWith('</')) {
      state.index += 2
      const closing = readName(state)
      skipWhitespace(state)
      if (closing !== tag || state.source[state.index] !== '>') {
        throw new Error(`mismatched </${closing}>`)
      }
      state.index += 1
      return node
    }
    if (state.index >= state.source.length) {
      throw new Error(`unterminated <${tag}>`)
    }
    const child = readNode(state, depth + 1)
    if (child) {
      node.children.push(child)
    }
  }
}

function skipText(state: ParserState): void {
  while (state.index < state.source.length && state.source[state.index] !== '<') {
    state.index += 1
  }
}

const NAME_RE = /[A-Za-z][A-Za-z0-9:._-]*/y

function readName(state: ParserState): string {
  NAME_RE.lastIndex = state.index
  const match = NAME_RE.exec(state.source)
  if (!match) {
    throw new Error('expected an element or attribute name')
  }
  state.index = NAME_RE.lastIndex
  // `xlink:href` y cualquier otro nombre con prefijo se normaliza al nombre
  // completo a proposito: asi nunca colapsa a un nombre de la lista blanca.
  return match[0]
}

function readAttributes(
  state: ParserState,
  isRoot: boolean
): { attributes: Record<string, string>; selfClosing: boolean } {
  const attributes: Record<string, string> = Object.create(null) as Record<string, string>
  for (;;) {
    skipWhitespace(state)
    const character = state.source[state.index]
    if (character === undefined) {
      throw new Error('unterminated element')
    }
    if (character === '>') {
      state.index += 1
      return { attributes: { ...attributes }, selfClosing: false }
    }
    if (character === '/') {
      state.index += 1
      if (state.source[state.index] !== '>') {
        throw new Error('malformed self-closing element')
      }
      state.index += 1
      return { attributes: { ...attributes }, selfClosing: true }
    }
    const name = readName(state)
    skipWhitespace(state)
    if (state.source[state.index] !== '=') {
      // A bare attribute carries no value an icon can use; refusing keeps the
      // parser from guessing where the value ended.
      throw new Error(`attribute ${name} has no value`)
    }
    state.index += 1
    skipWhitespace(state)
    const value = readAttributeValue(state)
    const accepted = acceptAttribute(name, value, isRoot)
    if (accepted !== null) {
      attributes[accepted.name] = accepted.value
    }
  }
}

function readAttributeValue(state: ParserState): string {
  const quote = state.source[state.index]
  if (quote !== '"' && quote !== "'") {
    throw new Error('attribute values must be quoted')
  }
  state.index += 1
  const end = state.source.indexOf(quote, state.index)
  if (end === -1) {
    throw new Error('unterminated attribute value')
  }
  const value = state.source.slice(state.index, end)
  state.index = end + 1
  if (value.length > MAX_ATTRIBUTE_LENGTH) {
    throw new Error('attribute value is too long')
  }
  return decodeEntities(value)
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body.startsWith('#x')
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
    }
    return Object.hasOwn(ENTITIES, body.toLowerCase())
      ? (ENTITIES[body.toLowerCase()] ?? '')
      : match
  })
}

/** Unknown, event, reference and styling attributes are dropped silently; the
 *  icon still renders from whatever geometry survived. */
function acceptAttribute(
  name: string,
  value: string,
  isRoot: boolean
): { name: string; value: string } | null {
  if (isRoot && ROOT_ONLY_ATTRIBUTES.has(name)) {
    return { name, value: value.trim() }
  }
  if (!ALLOWED_ATTRIBUTES.has(name)) {
    return null
  }
  if (name === 'fill' || name === 'stroke') {
    // Forzar `currentColor` es lo que hace que el icono respete el tema: el
    // plugin no elige colores dentro del chrome del host.
    return { name, value: value.trim().toLowerCase() === 'none' ? 'none' : 'currentColor' }
  }
  return { name, value }
}
