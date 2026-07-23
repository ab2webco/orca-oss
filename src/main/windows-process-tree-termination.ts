import { execFile } from 'node:child_process'

const WINDOWS_PROCESS_TREE_KILL_TIMEOUT_MS = 5_000

export type WindowsProcessTreeTerminator = (pid: number) => Promise<void>

/** Terminates a Windows process tree before ConPTY closes and loses its descendants. */
export function terminateWindowsProcessTree(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    execFile(
      'taskkill.exe',
      ['/pid', String(pid), '/T', '/F'],
      { timeout: WINDOWS_PROCESS_TREE_KILL_TIMEOUT_MS, windowsHide: true },
      (error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      }
    )
  })
}
