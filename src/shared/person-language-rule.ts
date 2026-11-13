import type { SupportedUiLocale } from './ui-locale'

const LANGUAGE_NAMES: Partial<Record<SupportedUiLocale, string>> = { es: 'Spanish' }

/** The language the person reads, named for an agent brief; null for English, which the briefs already assume. */
export function personLanguageNameOf(locale: SupportedUiLocale | undefined): string | null {
  return (locale && LANGUAGE_NAMES[locale]) ?? null
}
