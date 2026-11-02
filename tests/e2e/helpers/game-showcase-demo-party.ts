import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'

// Invented demo data for the README GIFs: a "Lumen" app team on example.com, no real people,
// hosts or repositories.
const GB = 1024 ** 3
const HOLD_MS = 1_500

type Ci = 'pending' | 'success' | 'failure'
type MemberState = 'working' | 'waiting' | 'idle' | 'done'

export type DemoMember = {
  name: string
  ticket: string
  title: string
  state: MemberState
  tool?: string | null
  pr?: { number: number; ci: Ci; state: 'open' | 'merged' } | null
  host?: string | null
  account?: string
}

export const demoMember = (member: DemoMember) => ({
  paneKey: member.host
    ? `remote:ctx_${member.ticket.toLowerCase()}`
    : `demo-${member.name.toLowerCase()}`,
  displayName: member.name,
  agentType: 'claude',
  state: member.state,
  toolName: member.tool ?? null,
  isLeader: false,
  isMember: true,
  worktree: {
    id: `demo-wt-${member.ticket}`,
    branch: `feat/${member.ticket.toLowerCase()}`,
    displayName: member.ticket
  },
  workItem: {
    provider: 'plane',
    identifier: member.ticket,
    title: member.title,
    url: `https://plane.example.com/lumen/browse/${member.ticket}/`,
    status: member.pr?.state === 'merged' ? 'Done' : 'In Progress',
    statusGroup: member.pr?.state === 'merged' ? 'done' : 'in_progress'
  },
  ...(member.pr
    ? {
        review: {
          provider: 'github',
          number: member.pr.number,
          title: member.title,
          url: `https://github.example.com/lumen/app/pull/${member.pr.number}`,
          state: member.pr.state,
          ci: member.pr.ci
        }
      }
    : {}),
  ...(member.account
    ? {
        account: {
          provider: 'claude',
          id: `${member.host ? `remote:env_${member.host}:` : ''}${member.account}`,
          email: member.account
        }
      }
    : {}),
  ...(member.host ? { remote: { host: member.host, stateKnown: true } } : {})
})

export const demoHost = (
  host: string,
  running: number,
  cap: number,
  machine: { cores: number; totalGb: number; freeGb: number; load: number }
) => ({
  host,
  running,
  cap,
  status: 'ok',
  cpuCoreCount: machine.cores,
  totalMemory: machine.totalGb * GB,
  availableMemory: machine.freeGb * GB,
  loadAverage1m: machine.load
})

/** A lead's `game state --json` for the Lumen team; `extra` adds hostCapacity, metrics, project… */
export const demoLeadState = (
  members: ReturnType<typeof demoMember>[],
  extra: Record<string, unknown> = {}
) => ({
  config: { mode: 'on', hud: true, rewards: true, render: 'hd', scene: 'quest' },
  sources: {},
  warnings: [],
  worktree: { id: 'demo-wt-lead', path: '/work/lumen-app', branch: 'main', displayName: 'lumen' },
  agents: [
    {
      paneKey: 'demo-atlas',
      displayName: 'Atlas',
      agentType: 'claude',
      state: 'working',
      toolName: 'Read',
      isLeader: true
    },
    ...members
  ],
  review: null,
  workItem: null,
  extensions: { scenes: [] },
  links: [],
  activity: null,
  role: 'lead',
  locale: 'en',
  ...extra
})

export async function sizeWindow(
  electronApp: ElectronApplication,
  width: number,
  height: number
): Promise<void> {
  await electronApp.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]?.setSize(size.width, size.height)
    },
    { width, height }
  )
}

/** Saves one GIF frame after the pane has settled. */
export async function showcaseFrame(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await page.waitForTimeout(HOLD_MS)
  await page.screenshot({ path: testInfo.outputPath(name), animations: 'disabled' })
}
