import { describe, expect, it } from 'vitest'
import { ALL_RPC_METHODS } from './index'
import { PLANE_METHODS } from './plane'
import { buildRegistry } from '../core'

describe('ALL_RPC_METHODS', () => {
  it('includes every PLANE_METHODS entry exactly once', () => {
    const names = ALL_RPC_METHODS.map((method) => method.name)
    for (const method of PLANE_METHODS) {
      expect(names.filter((name) => name === method.name)).toHaveLength(1)
    }
  })

  it('builds a registry without duplicate method names', () => {
    expect(() => buildRegistry(ALL_RPC_METHODS)).not.toThrow()
  })
})
