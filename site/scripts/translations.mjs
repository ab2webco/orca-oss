// pnpm translations check            list missing, stale or misshapen translations
// pnpm translations stamp <es file>  record the hash of the English text it now matches
import { LOCALES, stampTranslation, translationStatus } from './docs-translations.mjs'
import { buildRoutes } from './sync-docs.mjs'

const [command, ...args] = process.argv.slice(2)

if (command === 'stamp' && args.length > 0) {
  for (const target of args) {
    const { target: rel, hash } = stampTranslation(target)
    process.stdout.write(`stamped ${rel} ${hash}\n`)
  }
} else if (command === 'check') {
  const problems = [...buildRoutes().keys()]
    .flatMap((repoPath) => LOCALES.map((locale) => translationStatus(repoPath, locale)))
    .filter((status) => status.state !== 'current')
  for (const status of problems) {
    process.stdout.write(
      `${status.state}: ${status.target}${status.reason ? ` (${status.reason})` : ''}\n`
    )
  }
  process.exitCode = problems.length === 0 ? 0 : 1
} else {
  process.stderr.write('usage: pnpm translations check | stamp <translation.md>...\n')
  process.exitCode = 2
}
