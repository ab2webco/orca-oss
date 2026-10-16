import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const PLUGINS_DIR = join(import.meta.dirname, '..', '..', 'resources', 'claude-plugins')

// Why: `claude plugin validate` rejects a types contract that reaches outside its own file.
const OUTSIDE_REACH =
  /^\s*import\b|^\s*export\s+(type\s+)?(\*|\{[^}]*\})(\s+as\s+\w+)?\s+from\s|\brequire\(|\/\/\/\s*<reference\b/m

const contractsOf = async () => {
  const plugins = await readdir(PLUGINS_DIR, { withFileTypes: true })
  const contracts = []
  for (const plugin of plugins.filter((entry) => entry.isDirectory())) {
    const typesDir = join(PLUGINS_DIR, plugin.name, 'types')
    const files = await readdir(typesDir).catch(() => [])
    for (const file of files.filter((name) => name.endsWith('.d.ts'))) {
      contracts.push({
        path: join(plugin.name, 'types', file),
        text: await readFile(join(typesDir, file), 'utf8')
      })
    }
  }
  return contracts
}

describe('bundled Claude plugin type contracts', () => {
  it('finds the orca-game contract', async () => {
    const paths = (await contractsOf()).map((contract) => contract.path)
    expect(paths).toContain(join('orca-game', 'types', 'index.d.ts'))
  })

  it('keeps every contract self-contained', async () => {
    const reaching = (await contractsOf())
      .filter((contract) => OUTSIDE_REACH.test(contract.text))
      .map((contract) => contract.path)
    expect(reaching).toEqual([])
  })
})
