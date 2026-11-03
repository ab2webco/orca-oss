import { chmod, mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A plain Claude Code (no mod) for recorded clips, pointed at the scripted Messages API: a fresh
// config that trusts `projectDir`, skips onboarding and every startup notice.
const DEMO_KEY = 'sk-ant-api03-readme-demo-000000000000000000000000000000000000'

/** Writes a launcher that starts Claude in `projectDir`; returns its path and the temp root. */
export async function writeShowcaseClaude(options: {
  projectDir: string
  apiUrl: string
  theme: 'dark' | 'light'
}): Promise<{ launcher: string; root: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-showcase-claude-')))
  const configDir = join(root, 'claude-config')
  await mkdir(configDir)
  const trusted = { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true }
  await writeFile(
    join(configDir, '.claude.json'),
    JSON.stringify({
      hasCompletedOnboarding: true,
      theme: options.theme,
      copyOnSelect: false,
      numStartups: 5,
      hasSeenAutoDefaultNudge: true,
      customApiKeyResponses: { approved: [DEMO_KEY.slice(-20)], rejected: [] },
      projects: { [options.projectDir]: trusted }
    })
  )
  await writeFile(
    join(configDir, 'settings.json'),
    JSON.stringify({ permissions: { defaultMode: 'default' } })
  )
  const env = {
    CLAUDE_CONFIG_DIR: configDir,
    ANTHROPIC_API_KEY: DEMO_KEY,
    ANTHROPIC_BASE_URL: options.apiUrl,
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_NO_FLICKER: '1'
  }
  const launcher = join(root, 'claude-demo')
  await writeFile(
    launcher,
    `#!/bin/sh\nunset CLAUDE_CODE_OAUTH_TOKEN\n${Object.entries(env)
      .map(([key, value]) => `export ${key}='${value}'`)
      .join('\n')}\ncd '${options.projectDir}'\nexec claude\n`
  )
  await chmod(launcher, 0o755)
  return { launcher, root }
}
