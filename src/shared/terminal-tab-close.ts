/** Who asked for the close. A `runtime` close is the CLI, an RPC caller, or a
 *  paired phone — it tears the tab down like a user close, but it is not the
 *  user vouching that the pane's agent finished, so it must not retire resume
 *  authority (ORCA-272). Absent means `user`. */
export type TerminalTabCloseOrigin = 'user' | 'runtime'

export type TerminalTabCloseRequest = {
  requestId: string
  tabId: string
  localPtyTeardownOwnedExternally?: boolean
  origin?: TerminalTabCloseOrigin
}

export type TerminalTabCloseResponse = {
  requestId: string
  error?: string
}
