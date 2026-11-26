import { useEffect } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { UnreadProtectedSecret } from '../../../../shared/unread-protected-secret'

export const UNREAD_PROTECTED_SECRETS_TOAST_ID = 'unread-protected-secrets'

function unreadProtectedSecretLabel(secret: UnreadProtectedSecret): string {
  switch (secret) {
    case 'httpProxyUrl':
      return translate(
        'auto.components.protected.secrets.unread.protected.secrets.notice.f69e07d826',
        'Network proxy URL'
      )
    case 'opencodeSessionCookie':
      return translate(
        'auto.components.protected.secrets.unread.protected.secrets.notice.76b5a1c580',
        'OpenCode session cookie'
      )
    case 'browserKagiSessionLink':
      return translate(
        'auto.components.protected.secrets.unread.protected.secrets.notice.b15232f507',
        'Kagi session link'
      )
    case 'sshSessionRecovery':
      return translate(
        'auto.components.protected.secrets.unread.protected.secrets.notice.45f9f59b29',
        'SSH session recovery'
      )
  }
}

export function showUnreadProtectedSecretsNotice(unread: readonly UnreadProtectedSecret[]): void {
  if (unread.length === 0) {
    return
  }
  toast.warning(
    translate(
      'auto.components.protected.secrets.unread.protected.secrets.notice.ff65db1ab3',
      'Some saved secrets could not be read'
    ),
    {
      id: UNREAD_PROTECTED_SECRETS_TOAST_ID,
      description: translate(
        'auto.components.protected.secrets.unread.protected.secrets.notice.6a9d13afa9',
        'The system keychain did not answer at startup, so these stay saved but unused: {{names}}. Allow the keychain prompt if it is still open, or restart Orca Lab to try again.',
        { names: unread.map(unreadProtectedSecretLabel).join(', ') }
      ),
      duration: Infinity,
      dismissible: true
    }
  )
}

// Why: main returns the list once per app session, so a renderer reload does not repeat the notice.
export function useUnreadProtectedSecretsNotice(): void {
  useEffect(() => {
    void window.api.settings
      .takeUnreadProtectedSecrets()
      .then(showUnreadProtectedSecretsNotice)
      .catch(() => {})
  }, [])
}
