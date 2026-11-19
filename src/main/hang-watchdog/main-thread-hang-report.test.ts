import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  appendMainThreadHangResolution,
  descendantProcessRows,
  writeMainThreadHangReport,
  type HangReportDeps
} from './main-thread-hang-report'

const PS_LISTING = [
  '    1     0 10-00:00:00 Ss   /sbin/launchd',
  '  633     1 1-02:00:00 S    /Applications/Orca Lab.app/Contents/MacOS/Orca Lab',
  '  700   633    05:12 S    git -C /repo status --porcelain=v2',
  '  701   700    05:12 S    ssh -o BatchMode=yes git@github.com',
  '  702   633    00:01 R    ps -A -o pid= -o ppid= -o etime= -o stat= -o args=',
  '  800     1    00:10 S    unrelated --token=abc123'
].join('\n')

describe('descendantProcessRows', () => {
  it('lists children and grandchildren of the main pid only, without its own ps', () => {
    expect(descendantProcessRows(PS_LISTING, 633)).toEqual([
      '700   633    05:12 S    git -C /repo status --porcelain=v2',
      '701   700    05:12 S    ssh -o BatchMode=yes git@github.com'
    ])
  })

  it('redacts secrets on a child command line', () => {
    const rows = descendantProcessRows('9 1 00:01 S curl -H Authorization: Bearer abc.def', 1)
    expect(rows[0]).not.toContain('abc.def')
  })

  it('reads the Windows tab-separated listing', () => {
    expect(descendantProcessRows('633\t1\tOrca.exe\r\n640\t633\tgit.exe status\r\n', 633)).toEqual([
      '640\t633\tgit.exe status'
    ])
  })
})

describe('writeMainThreadHangReport', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hang-report-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const write = (deps: HangReportDeps, name = 'main-hang-633-a.txt'): string => {
    const reportPath = join(dir, 'logs', name)
    writeMainThreadHangReport(
      { reportPath, parentPid: 633, unresponsiveMs: 31_000, detectedAt: Date.UTC(2026, 10, 19) },
      deps
    )
    return reportPath
  }

  it('on macOS records child processes and the sample of every thread', () => {
    const run = vi.fn((file: string, args: string[]) => {
      if (file === 'ps') {
        return PS_LISTING
      }
      writeFileSync(String(args.at(-1)), 'Call graph:\n  Thread_1 com.apple.main-thread\n')
      return ''
    })
    const reportPath = write({
      platform: 'darwin',
      run,
      readText: (path) => readFileSync(path, 'utf8'),
      listDir: () => []
    })
    expect(run).toHaveBeenCalledWith('/usr/bin/sample', [
      '633',
      '3',
      '-mayDie',
      '-file',
      `${reportPath}.sample`
    ])
    const text = readFileSync(reportPath, 'utf8')
    expect(text).toContain('Orca Lab main process 633 stopped answering')
    expect(text).toContain('after 31000 ms without an answer')
    expect(text).toContain('git -C /repo status')
    expect(text).toContain('com.apple.main-thread')
    expect(readdirSync(join(dir, 'logs'))).toEqual(['main-hang-633-a.txt'])
  })

  it('on Linux records each thread state, wait channel and syscall', () => {
    const files: Record<string, string> = {
      '/proc/633/task/633/comm': 'Orca Lab\n',
      '/proc/633/task/633/stat': '633 (Orca Lab) S 1 633',
      '/proc/633/task/633/wchan': 'do_wait',
      '/proc/633/task/633/syscall': '61 0x1 0x2'
    }
    const reportPath = write({
      platform: 'linux',
      run: () => PS_LISTING,
      readText: (path) => {
        const value = files[path]
        if (value === undefined) {
          throw new Error('missing')
        }
        return value
      },
      listDir: () => ['633', '640']
    })
    const text = readFileSync(reportPath, 'utf8')
    expect(text).toContain('633 Orca Lab state=S wchan=do_wait syscall=61')
    expect(text).toContain('640 ? state=? wchan=? syscall=?')
  })

  it('keeps the header when a capture fails', () => {
    const reportPath = write({
      platform: 'win32',
      run: () => {
        throw new Error('powershell missing')
      },
      readText: () => '',
      listDir: () => []
    })
    const text = readFileSync(reportPath, 'utf8')
    expect(text).toContain('(could not capture: powershell missing)')
    expect(text).toContain('not captured on this platform')
  })

  it('keeps only the five newest records', () => {
    const deps: HangReportDeps = {
      platform: 'win32',
      run: () => '',
      readText: () => '',
      listDir: () => []
    }
    for (let index = 0; index < 6; index += 1) {
      const path = write(deps, `main-hang-633-${index}.txt`)
      utimesSync(path, index, index)
    }
    write(deps, 'main-hang-633-9.txt')
    expect(readdirSync(join(dir, 'logs')).sort()).toEqual([
      'main-hang-633-2.txt',
      'main-hang-633-3.txt',
      'main-hang-633-4.txt',
      'main-hang-633-5.txt',
      'main-hang-633-9.txt'
    ])
  })

  it('appends when the main thread answers again', () => {
    const reportPath = write({
      platform: 'win32',
      run: () => '',
      readText: () => '',
      listDir: () => []
    })
    appendMainThreadHangResolution(reportPath, 42_000)
    expect(readFileSync(reportPath, 'utf8')).toContain('Main thread answered again after 42000 ms.')
  })
})
