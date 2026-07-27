import { describe, expect, it } from 'vitest'
import { UNIX_SOCKET_PATH_LIMIT_BYTES } from '../runtime/runtime-socket-path'
import { getRemoteHostPlatform } from './ssh-remote-platform'
import { relayEndpointForHost } from './ssh-relay-endpoints'

const SOCKET_NAME = 'relay.sock'

function posixEndpointWithByteLength(byteLength: number): string {
  const directoryLength = byteLength - Buffer.byteLength(`/${SOCKET_NAME}`, 'utf8')
  return `/${'a'.repeat(directoryLength - 1)}`
}

describe('relayEndpointForHost', () => {
  it('accepts a macOS endpoint strictly below its sun_path limit', () => {
    const host = getRemoteHostPlatform('darwin-arm64')
    const remoteDir = posixEndpointWithByteLength(UNIX_SOCKET_PATH_LIMIT_BYTES.darwin - 1)

    const endpoint = relayEndpointForHost(host, remoteDir, SOCKET_NAME)

    expect(Buffer.byteLength(endpoint, 'utf8')).toBe(UNIX_SOCKET_PATH_LIMIT_BYTES.darwin - 1)
  })

  it('rejects a macOS endpoint at the sun_path limit because the NUL terminator counts', () => {
    const host = getRemoteHostPlatform('darwin-x64')
    const remoteDir = posixEndpointWithByteLength(UNIX_SOCKET_PATH_LIMIT_BYTES.darwin)

    expect(() => relayEndpointForHost(host, remoteDir, SOCKET_NAME)).toThrow(
      'SSH relay Unix socket path is 104 bytes; macOS sun_path requires fewer than 104 bytes'
    )
  })

  it('accepts Linux endpoints that are valid above the macOS limit', () => {
    const host = getRemoteHostPlatform('linux-x64')
    const remoteDir = posixEndpointWithByteLength(UNIX_SOCKET_PATH_LIMIT_BYTES.linux - 1)

    const endpoint = relayEndpointForHost(host, remoteDir, SOCKET_NAME)

    expect(Buffer.byteLength(endpoint, 'utf8')).toBe(UNIX_SOCKET_PATH_LIMIT_BYTES.linux - 1)
  })

  it('rejects a Linux endpoint at its sun_path limit', () => {
    const host = getRemoteHostPlatform('linux-arm64')
    const remoteDir = posixEndpointWithByteLength(UNIX_SOCKET_PATH_LIMIT_BYTES.linux)

    expect(() => relayEndpointForHost(host, remoteDir, SOCKET_NAME)).toThrow(
      'SSH relay Unix socket path is 108 bytes; Linux sun_path requires fewer than 108 bytes'
    )
  })

  it('measures UTF-8 bytes rather than JavaScript string length', () => {
    const host = getRemoteHostPlatform('darwin-arm64')
    const remoteDir = `/${'é'.repeat(47)}`

    expect(() => relayEndpointForHost(host, remoteDir, SOCKET_NAME)).toThrow(
      'SSH relay Unix socket path is 106 bytes'
    )
  })
})
