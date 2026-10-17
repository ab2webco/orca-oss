// Ordinary UI vocabulary that reads like a brand but is not one. Every locale should translate
// these, so the policy must neither pin the whole value to English nor revert the translation
// inside a sentence. The product-name homonyms (Continue.dev, the agent entries) stay Latin
// through ENGLISH_ONLY_KEY_PREFIXES, which matches on the catalog key rather than the word.

// Renderings a locale is expected to use. They are translations, never machine-translation
// errors, so a brand revert must leave them alone. Nonsense forms that share the same English
// term (es "Comprometerse") stay in BRAND_MISTRANSLATIONS and keep getting reverted.
const GENERIC_TERM_FAMILIES = [
  {
    terms: ['Agent', 'Agents', 'agent', 'agents'],
    renderings: {
      es: ['Agente', 'agente', 'Agentes', 'agentes']
    }
  },
  {
    terms: ['Commit', 'Commits', 'commit', 'commits'],
    renderings: {
      es: [
        'Confirmación',
        'confirmación',
        'Confirmaciones',
        'confirmaciones',
        'Confirmar',
        'confirmar'
      ]
    }
  },
  {
    terms: ['Continue'],
    renderings: {
      es: ['Continuar', 'continuar']
    }
  },
  {
    terms: ['Repo', 'Repos', 'repo', 'repos'],
    renderings: {
      es: ['Repositorio', 'repositorio', 'Repositorios', 'repositorios']
    }
  },
  {
    terms: ['Terminal', 'Terminals', 'terminal', 'terminals'],
    renderings: {
      es: ['Terminales', 'terminales']
    }
  }
]

export const LOCALIZABLE_GENERIC_TERMS = new Set(
  GENERIC_TERM_FAMILIES.flatMap((family) => family.terms)
)

const RENDERINGS_BY_TERM = new Map(
  GENERIC_TERM_FAMILIES.flatMap((family) => family.terms.map((term) => [term, family.renderings]))
)

export function isLocalizableGenericTerm(term) {
  return LOCALIZABLE_GENERIC_TERMS.has(term)
}

export function isCanonicalGenericRendering(term, locale, form) {
  return RENDERINGS_BY_TERM.get(term)?.[locale]?.includes(form) ?? false
}

export function canonicalGenericRenderings(locale) {
  return GENERIC_TERM_FAMILIES.flatMap((family) =>
    (family.renderings[locale] ?? []).map((form) => ({ form, terms: family.terms }))
  )
}

function spansOf(value, needle) {
  const spans = []
  for (let at = value.indexOf(needle); at !== -1; at = value.indexOf(needle, at + 1)) {
    spans.push([at, at + needle.length])
  }
  return spans
}

// Why: a canonical rendering can contain a mistranslated form, so a blind revert would cut a
// valid word in half.
export function overlapsCanonicalRendering(term, locale, value, start, end) {
  const renderings = RENDERINGS_BY_TERM.get(term)?.[locale] ?? []
  return renderings.some((form) =>
    spansOf(value, form).some(([from, to]) => start < to && from < end)
  )
}
