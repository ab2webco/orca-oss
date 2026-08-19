/**
 * Counts the E2E tests that no CI lane can fail: tags the headless project greps
 * out, `test.fixme` declarations, and the conditional gates that turn a missing
 * global-setup fixture into a green test.
 *
 * Declarations, not tests: a tagged `describe` hides every test under it, and this
 * scan reads source rather than resolving Playwright's grep.
 */

const TAG_PATTERN = /@headful|@ondemand/
const DECLARATION_PATTERN = /^\s*test(?:\.describe)?(?:\.\w+)*\s*\(\s*(['"`])(.*?)\1/
const FIXME_PATTERN = /^\s*test\.fixme\s*\(\s*(['"`])(.*?)\1/
// A gate is `test.skip(condition, ...)`: a skip whose first argument is not a title.
const GATE_PATTERN = /^\s*test\.skip\s*\(\s*(?!['"`])/
const TICKET_PATTERN = /(ORCA-\d+|#\d{2,}|issue-\d+)/i
const GLOBAL_SETUP_PATTERN = /global setup/i
// How far above a declaration its owning comment block can start.
const COMMENT_LOOKBACK = 30

/**
 * @typedef {{ file: string, line: number, tag: string, title: string }} TaggedDeclaration
 * @typedef {{ file: string, line: number, title: string, ticket: string | null }} FixmeDeclaration
 * @typedef {{ file: string, line: number, reason: string, globalSetupGate: boolean }} ConditionalGate
 * @typedef {{ tagged: TaggedDeclaration[], fixmes: FixmeDeclaration[], gates: ConditionalGate[] }} SpecCensus
 */

/** @param {string[]} lines @returns {Map<string, string>} */
function stringConstants(lines) {
  /** @type {Map<string, string>} */
  const constants = new Map()
  for (const line of lines) {
    const match = /^\s*const\s+([A-Z][A-Z0-9_]*)\s*=\s*(['"`])([^'"`]*)\2/.exec(line)
    if (match) {
      constants.set(match[1], match[3])
    }
  }
  return constants
}

/**
 * @param {string[]} lines
 * @param {number} index
 * @param {Map<string, string>} constants
 */
function gateReason(lines, index, constants) {
  const call = lines.slice(index, index + 4).join(' ')
  const quoted = /(['"`])([^'"`]{4,})\1/.exec(call)
  if (quoted) {
    return quoted[2]
  }
  // A reason hoisted into a constant is still a reason; missing it undercounts.
  const named = [...constants.keys()].find((name) => call.includes(name))
  return named ? (constants.get(named) ?? '') : ''
}

/** @param {string[]} lines @param {number} index */
function ticketNear(lines, index) {
  const window = lines.slice(Math.max(0, index - COMMENT_LOOKBACK), index + 1).join('\n')
  return TICKET_PATTERN.exec(window)?.[1] ?? null
}

/**
 * @param {string} file spec path as the reader should see it
 * @param {string} source
 * @returns {SpecCensus}
 */
export function censusSpecSource(file, source) {
  const lines = source.split('\n')
  const constants = stringConstants(lines)
  /** @type {SpecCensus} */
  const census = { tagged: [], fixmes: [], gates: [] }
  lines.forEach((line, index) => {
    const declaration = DECLARATION_PATTERN.exec(line)
    if (declaration && TAG_PATTERN.test(declaration[2])) {
      for (const tag of declaration[2].match(/@[\w-]+/g) ?? []) {
        if (TAG_PATTERN.test(tag)) {
          census.tagged.push({ file, line: index + 1, tag, title: declaration[2] })
        }
      }
    }
    const fixme = FIXME_PATTERN.exec(line)
    if (fixme) {
      census.fixmes.push({
        file,
        line: index + 1,
        title: fixme[2],
        ticket: ticketNear(lines, index)
      })
    }
    if (GATE_PATTERN.test(line)) {
      const reason = gateReason(lines, index, constants)
      census.gates.push({
        file,
        line: index + 1,
        reason,
        globalSetupGate: GLOBAL_SETUP_PATTERN.test(reason)
      })
    }
  })
  return census
}

/**
 * @param {SpecCensus[]} entries
 * @returns {{ tagged: TaggedDeclaration[], fixmes: FixmeDeclaration[], gates: ConditionalGate[], totals: Record<string, number> }}
 */
export function summarizeCensus(entries) {
  const tagged = entries.flatMap((entry) => entry.tagged)
  const fixmes = entries.flatMap((entry) => entry.fixmes)
  const gates = entries.flatMap((entry) => entry.gates)
  return {
    tagged,
    fixmes,
    gates,
    totals: {
      headfulDeclarations: tagged.filter((entry) => entry.tag === '@headful').length,
      ondemandDeclarations: tagged.filter((entry) => entry.tag === '@ondemand').length,
      taggedFiles: new Set(tagged.map((entry) => entry.file)).size,
      fixmes: fixmes.length,
      fixmesWithoutTicket: fixmes.filter((entry) => entry.ticket === null).length,
      gates: gates.length,
      globalSetupGates: gates.filter((entry) => entry.globalSetupGate).length
    }
  }
}
