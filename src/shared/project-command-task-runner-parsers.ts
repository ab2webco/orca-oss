// Why: make/just/rake are parsed from text, never run, so detection cannot execute repo code.

const MAKE_RULE = /^([A-Za-z0-9_][A-Za-z0-9_ \t./-]*?)\s*::?(?![:=])/
// Why: dots and slashes name files (`main.o`, `dist/app`), not commands a person runs.
const MAKE_TARGET = /^[A-Za-z0-9_-]+$/

export function parseMakefileTargets(content: string): string[] {
  const targets: string[] = []
  let inDefine = false
  for (const line of content.split(/\r?\n/)) {
    if (/^define\b/.test(line)) {
      inDefine = true
      continue
    }
    if (inDefine) {
      inDefine = !/^endef\b/.test(line)
      continue
    }
    const match = MAKE_RULE.exec(line)
    if (!match) {
      continue
    }
    targets.push(...match[1].split(/\s+/).filter((target) => MAKE_TARGET.test(target)))
  }
  return [...new Set(targets)]
}

const JUST_RECIPE = /^@?([A-Za-z_][A-Za-z0-9_-]*)([^:]*):(?!=)/
const JUST_PARAM = /(?:[^\s'"]|'[^']*'|"[^"]*")+/g

/** Recipes `just <name>` can run with no arguments; private ones are left out. */
export function parseJustfileRecipes(content: string): string[] {
  const recipes: string[] = []
  let nextIsPrivate = false
  for (const line of content.split(/\r?\n/)) {
    if (/^\[.*\bprivate\b.*\]\s*$/.test(line)) {
      nextIsPrivate = true
      continue
    }
    const match = JUST_RECIPE.exec(line)
    if (!match) {
      continue
    }
    const isPrivate = nextIsPrivate || match[1].startsWith('_')
    nextIsPrivate = false
    const params = match[2].match(JUST_PARAM) ?? []
    const needsArguments = params.some((param) => !param.includes('=') && !param.startsWith('*'))
    if (!isPrivate && !needsArguments) {
      recipes.push(match[1])
    }
  }
  return [...new Set(recipes)]
}

const RAKE_NAMESPACE = /^namespace\s*\(?\s*(?::([\w-]+)|["']([\w-]+)["'])\s*\)?\s+do\b/
const RAKE_TASK = /^task\s*\(?\s*(?::([\w-]+)|["']([\w:-]+)["']|([\w-]+):(?!:))/

/** Task names with their namespaces, e.g. `db:migrate`; nesting is read from `end` indentation. */
export function parseRakefileTasks(content: string): string[] {
  const tasks: string[] = []
  const namespaces: { name: string; indent: number }[] = []
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    const indent = line.length - line.trimStart().length
    if (trimmed === 'end' && namespaces.at(-1)?.indent === indent) {
      namespaces.pop()
      continue
    }
    const namespace = RAKE_NAMESPACE.exec(trimmed)
    if (namespace) {
      namespaces.push({ name: namespace[1] ?? namespace[2], indent })
      continue
    }
    const task = RAKE_TASK.exec(trimmed)
    if (task) {
      const name = task[1] ?? task[2] ?? task[3]
      tasks.push([...namespaces.map((entry) => entry.name), name].join(':'))
    }
  }
  return [...new Set(tasks)]
}
