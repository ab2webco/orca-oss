// A saved secret Orca kept encrypted because the system keychain did not give it up at startup.
export type UnreadProtectedSecret =
  | 'httpProxyUrl'
  | 'opencodeSessionCookie'
  | 'browserKagiSessionLink'
  | 'sshSessionRecovery'
