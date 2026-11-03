import { createHmac } from 'node:crypto'

/** An SSH wire-format public key blob: string type, then one opaque field. */
export function hostKeyBlob(keyType: string, seed: number): Buffer {
  const type = Buffer.from(keyType)
  const body = Buffer.alloc(32, seed)
  const blob = Buffer.alloc(8 + type.length + body.length)
  blob.writeUInt32BE(type.length, 0)
  type.copy(blob, 4)
  blob.writeUInt32BE(body.length, 4 + type.length)
  body.copy(blob, 8 + type.length)
  return blob
}

export function knownHostsLine(hosts: string, keyType: string, seed: number): string {
  return `${hosts} ${keyType} ${hostKeyBlob(keyType, seed).toString('base64')}`
}

/** The `|1|salt|hash` form `ssh-keygen -H` writes. */
export function hashedHost(host: string, saltSeed = 7): string {
  const salt = Buffer.alloc(20, saltSeed)
  const hash = createHmac('sha1', salt).update(host).digest()
  return `|1|${salt.toString('base64')}|${hash.toString('base64')}`
}
