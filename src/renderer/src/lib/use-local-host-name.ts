import { useTranslation } from 'react-i18next'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'
import { useAppStore } from '@/store'
import { localHostDisplayLabel } from './local-host-display-label'

/** This machine's shown name: the user's rename wins over the translated label (ORCA-1149). */
export function useLocalHostName(): string {
  // Why: the label is translated, and the views that show it are memoized.
  useTranslation()
  const renamed = useAppStore(
    (s) => s.settings?.hostSettingOverrides?.[LOCAL_EXECUTION_HOST_ID]?.displayLabel
  )
  return renamed?.trim() || localHostDisplayLabel()
}
