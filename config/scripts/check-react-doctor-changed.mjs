import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { resolvePullRequestDiffBase } from './git-pull-request-diff-base.mjs'

const requestedBase =
  process.argv.slice(2).find((argument) => argument !== '--') ??
  process.env.ORCA_CODE_QUALITY_BASE ??
  'origin/main'
// Why syncAware here and not in check:code-quality:changed — see resolvePullRequestDiffBase.
const base = resolvePullRequestDiffBase(process.cwd(), requestedBase, undefined, {
  syncAware: true
})
// Why here and not in the workflow: a caller that computes the base separately
// can print one ref while this resolves another, which is how a base fix read
// as landed for a full sync cycle without ever reaching the tool (ORCA-202).
console.log(`React Doctor measures changed lines against ${base}`)
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const result = spawnSync(
  pnpm,
  [
    'dlx',
    'react-doctor@0.9.1',
    '.',
    '--yes',
    '--scope',
    'lines',
    '--base',
    base,
    '--include-untracked',
    '--no-dead-code',
    '--no-supply-chain',
    '--no-telemetry',
    '--blocking',
    'error'
  ],
  { stdio: 'inherit' }
)

if (result.error) {
  throw result.error
}
process.exit(result.status ?? 1)
