import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

// ORCA-812: every WebView routes navigation decisions through this singleton. WebKit stores a
// handler on the main thread while JS resolves it on the TurboModule queue, so an unguarded
// NSMutableDictionary crashed in -[__NSDictionaryM objectForKey:] (symbolicated 0.0.56 build 1).
const require = createRequire(import.meta.url)
const webviewRoot = dirname(require.resolve('react-native-webview/package.json'))
const decisionManagerDir = join(webviewRoot, 'apple')
const decisionManagerSource = join(decisionManagerDir, 'RNCWebViewDecisionManager.m')

// Main thread stores handlers while a second thread resolves them, as WebKit and the
// TurboModule queue do on device.
const raceDriver = `
#import <Foundation/Foundation.h>
#import "RNCWebViewDecisionManager.h"
#include <stdatomic.h>

int main(void) {
  @autoreleasepool {
    RNCWebViewDecisionManager *manager = [RNCWebViewDecisionManager getInstance];
    const int iterations = 20000;
    __block atomic_int resolved = 0;
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      for (int lock = 1; lock <= iterations; lock++) {
        while (atomic_load(&resolved) < lock) {
          [manager setResult:YES forLockIdentifier:lock];
        }
      }
      dispatch_semaphore_signal(done);
    });
    for (int index = 0; index < iterations; index++) {
      [manager setDecisionHandler:^(BOOL shouldStart) {
        atomic_fetch_add(&resolved, 1);
      }];
    }
    dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
    printf("resolved=%d\\n", atomic_load(&resolved));
  }
  return 0;
}
`

const isDarwin = process.platform === 'darwin'
const workDir = mkdtempSync(join(tmpdir(), 'orca-812-decision-manager-'))

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true })
})

function buildRaceBinary(): string {
  const includeDir = join(workDir, 'include')
  mkdirSync(join(includeDir, 'React'), { recursive: true })
  // Why: the class only needs RCTLogWarn from React; linking React Native here is not possible.
  writeFileSync(join(includeDir, 'React', 'RCTLog.h'), '#define RCTLogWarn(...) ((void)0)\n')
  const driverPath = join(workDir, 'race-driver.m')
  writeFileSync(driverPath, raceDriver)
  const binaryPath = join(workDir, 'race-driver')
  execFileSync(
    'xcrun',
    [
      'clang',
      '-fobjc-arc',
      '-fsanitize=thread',
      '-g',
      `-I${includeDir}`,
      `-I${decisionManagerDir}`,
      decisionManagerSource,
      driverPath,
      '-framework',
      'Foundation',
      '-o',
      binaryPath
    ],
    { stdio: 'pipe' }
  )
  return binaryPath
}

describe('RNCWebViewDecisionManager thread safety', () => {
  it('guards every handler-map access with a lock in the installed source', () => {
    const source = readFileSync(decisionManagerSource, 'utf8')
    const guardedMethods = ['setDecisionHandler', 'setResult'].map((selector) => {
      const method = source.match(new RegExp(`-\\s*\\(\\w+\\)\\s*${selector}:[\\s\\S]*?\\n\\}`))
      return [selector, method?.[0].includes('@synchronized') ?? false]
    })
    expect(guardedMethods).toEqual([
      ['setDecisionHandler', true],
      ['setResult', true]
    ])
  })

  it.skipIf(!isDarwin)(
    'reports no data race when handlers are stored and resolved on two threads',
    () => {
      const binaryPath = buildRaceBinary()
      const run = spawnSync(binaryPath, {
        encoding: 'utf8',
        env: { ...process.env, TSAN_OPTIONS: 'halt_on_error=1:exitcode=66' }
      })
      expect(run.stderr).not.toContain('ThreadSanitizer')
      expect(run.status).toBe(0)
      expect(run.stdout).toContain('resolved=20000')
    },
    120_000
  )
})
