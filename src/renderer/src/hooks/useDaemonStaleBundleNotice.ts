import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { isPluginUiLanguage } from '../../../shared/ui-language'
import { useAppStore } from '@/store'
import { usePluginLanguagePackStore } from '@/store/plugin-language-packs'
import { translate } from '@/i18n/i18n'
import { resolveUiLocale } from '@/i18n/supported-languages'
import { MANAGE_SESSIONS_SECTION_ID } from '@/components/settings/TerminalTccAttributionNotice'

const STALE_BUNDLE_NOTICE_ID = 'daemon-stale-bundle-notice'

type StaleBundleNoticeStatus =
  | { stale: false }
  | { stale: true; pid: number; startedAtMs: number | null; dismissed: boolean }

function instanceKeyOf(status: Extract<StaleBundleNoticeStatus, { stale: true }>): string {
  return `${status.pid}:${status.startedAtMs ?? 'unknown'}`
}

/**
 * Surfaces the "restart to apply terminal fixes" remedy when the adopted daemon predates the
 * running app bundle and is being kept alive only because it owns live terminal sessions
 * (ORCA-534). A daemon with no live sessions never reaches this hook: createOutOfProcessLauncher
 * already replaces it on the app's next launch.
 */
export function useDaemonStaleBundleNotice(): void {
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const setSettingsSearchQuery = useAppStore((s) => s.setSettingsSearchQuery)
  const uiLanguage = useAppStore((s) => s.settings?.uiLanguage ?? null)
  const pluginLanguagePacks = usePluginLanguagePackStore((s) => s.packs)
  const pluginLanguagePacksLoaded = usePluginLanguagePackStore((s) => s.loaded)
  const { i18n } = useTranslation()
  const selectedPluginLanguage = pluginLanguagePacks.find((pack) => pack.id === uiLanguage)
  const targetLocale =
    uiLanguage === null || (isPluginUiLanguage(uiLanguage) && !pluginLanguagePacksLoaded)
      ? null
      : (selectedPluginLanguage?.resourceLanguage ??
        (isPluginUiLanguage(uiLanguage) ? 'en' : resolveUiLocale(uiLanguage)))
  const localeReady =
    targetLocale !== null &&
    i18n.language === targetLocale &&
    i18n.hasResourceBundle(targetLocale, 'translation')
  // Why an instance key, not a boolean: a fresh (non-stale) daemon adopted later must be able
  // to toast again even though a previous daemon instance already showed and was dismissed.
  const shownForInstanceKey = useRef<string | null>(null)
  const checkInFlight = useRef(false)

  useEffect(() => {
    if (!localeReady) {
      return
    }
    const staleBundleNotice = window.api?.pty?.management?.staleBundleNotice
    const dismissStaleBundleNotice = window.api?.pty?.management?.dismissStaleBundleNotice
    if (!staleBundleNotice) {
      return
    }

    const maybeToast = async (): Promise<void> => {
      if (checkInFlight.current) {
        return
      }
      checkInFlight.current = true
      try {
        const status = (await staleBundleNotice()) as StaleBundleNoticeStatus
        if (!status.stale || status.dismissed) {
          if (shownForInstanceKey.current) {
            toast.dismiss(STALE_BUNDLE_NOTICE_ID)
            shownForInstanceKey.current = null
          }
          return
        }
        const instanceKey = instanceKeyOf(status)
        if (shownForInstanceKey.current === instanceKey) {
          return
        }
        shownForInstanceKey.current = instanceKey
        const { pid, startedAtMs } = status
        toast.warning(
          translate(
            'auto.hooks.useDaemonStaleBundleNotice.title',
            'A terminal fix needs a daemon restart'
          ),
          {
            id: STALE_BUNDLE_NOTICE_ID,
            description: translate(
              'auto.hooks.useDaemonStaleBundleNotice.description',
              'This update includes terminal fixes that only apply after the terminal service restarts. Running terminals are keeping the previous version alive. Restart it from Manage Sessions — this closes every running terminal.'
            ),
            duration: Infinity,
            action: {
              label: translate(
                'auto.hooks.useDaemonStaleBundleNotice.openManageSessions',
                'Open Manage Sessions'
              ),
              onClick: () => {
                setSettingsSearchQuery('')
                openSettingsTarget({
                  pane: 'terminal',
                  repoId: null,
                  sectionId: MANAGE_SESSIONS_SECTION_ID
                })
                openSettingsPage()
              }
            },
            cancel: {
              label: translate('auto.hooks.useDaemonStaleBundleNotice.dismiss', 'Dismiss'),
              onClick: () => {
                void dismissStaleBundleNotice?.({ pid, startedAtMs })
              }
            }
          }
        )
      } catch {
        // Rejection clears the guard so a later focus can retry.
      } finally {
        checkInFlight.current = false
      }
    }

    void maybeToast()
    const onFocus = (): void => {
      void maybeToast()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [localeReady, openSettingsPage, openSettingsTarget, setSettingsSearchQuery])
}
