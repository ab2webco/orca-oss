import { describe, expect, it } from 'vitest'
import { describeWindowsProcessExitCode } from './windows-process-exit-codes'

describe('describeWindowsProcessExitCode', () => {
  it('names the Crashpad code GitHub #822 reported as a signed int', () => {
    expect(describeWindowsProcessExitCode(-36861)).toBe(
      '0xFFFF7003 crashpad-not-connected-to-handler'
    )
  })

  it('names common NTSTATUS crash codes whether signed or unsigned', () => {
    expect(describeWindowsProcessExitCode(-1073741819)).toBe('0xC0000005 access-violation')
    expect(describeWindowsProcessExitCode(0xc0000409)).toBe('0xC0000409 stack-buffer-overrun')
    expect(describeWindowsProcessExitCode(0x80000003)).toBe('0x80000003 breakpoint')
  })

  it('still gives the hex form of an unknown status code', () => {
    expect(describeWindowsProcessExitCode(0xc0001234)).toBe('0xC0001234')
  })

  it('leaves small ordinary exit codes alone', () => {
    expect(describeWindowsProcessExitCode(1)).toBeNull()
    expect(describeWindowsProcessExitCode(0)).toBeNull()
  })
})
