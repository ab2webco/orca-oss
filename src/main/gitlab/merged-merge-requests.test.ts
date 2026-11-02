import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ api: vi.fn(), source: vi.fn() }))

vi.mock('./gl-utils', () => ({
  acquire: vi.fn(async () => undefined),
  release: vi.fn(),
  getGlabKnownHosts: vi.fn(async () => ['gitlab.example.com']),
  glabApiWithHeaders: mocks.api,
  glabHostnameArgs: (ref: { host?: string } | null, connectionId?: string | null) =>
    connectionId && ref?.host ? ['--hostname', ref.host] : [],
  glabRepoExecOptions: (repoPath: string, connectionId?: string | null) =>
    connectionId ? {} : { cwd: repoPath },
  parseGlabJsonList: (body: string) => JSON.parse(body),
  resolveIssueSource: mocks.source
}))

import { listMergedMergeRequestsSince } from './merged-merge-requests'

const args = { repoPath: '/repo', since: '2026-10-18T14:08:27.123Z', now: 1 }

describe('listMergedMergeRequestsSince', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.source.mockResolvedValue({
      source: { host: 'gitlab.example.com', path: 'group/project' },
      fellBack: false
    })
  })

  it('lists merged MRs updated since the window, over SSH with the host named', async () => {
    mocks.api.mockResolvedValueOnce({
      body: JSON.stringify([
        { iid: 4, created_at: '2026-11-01T10:00:00Z', merged_at: '2026-11-01T12:00:00Z' }
      ]),
      headers: { 'x-total': '1' }
    })
    const delivery = await listMergedMergeRequestsSince({ ...args, connectionId: 'ssh-1' })
    expect(delivery).toMatchObject({ provider: 'gitlab', repo: 'group/project', complete: true })
    expect(delivery?.reviews.map((one) => one.number)).toEqual([4])
    const [argv, options] = mocks.api.mock.calls[0]
    expect(argv[0]).toBe('--hostname')
    expect(argv[2]).toBe(
      'projects/group%2Fproject/merge_requests?state=merged&updated_after=2026-10-18T14%3A08%3A27.123Z' +
        '&order_by=updated_at&sort=desc&per_page=100&page=1'
    )
    expect(options).toEqual({})
  })

  it('answers null when the repo is not on a known GitLab host', async () => {
    mocks.source.mockResolvedValue({ source: null, fellBack: false })
    await expect(listMergedMergeRequestsSince(args)).resolves.toBeNull()
    expect(mocks.api).not.toHaveBeenCalled()
  })
})
