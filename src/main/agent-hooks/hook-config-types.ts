export type HookCommandConfig = {
  type: 'command'
  command: string
  args?: string[]
  timeout?: number
  async?: boolean
  statusMessage?: string
  [key: string]: unknown
}

export type HookDefinition = {
  matcher?: string
  command?: string
  bash?: string
  powershell?: string
  hooks?: HookCommandConfig[]
  [key: string]: unknown
}

export type HooksConfig = {
  hooks?: Record<string, HookDefinition[]>
  [key: string]: unknown
}
