// Consent, permission and warning copy the localization gate requires complete in
// every locale (ORCA-284). Pinned as key overrides rather than written straight
// into the catalogs because repair-locale-catalog rewrites plain catalog values;
// the same reason the macOS TCC copy for this pane lives in overrides.
//
// `Local Network`, `Privacy & Security` and `System Settings` are macOS UI labels:
// they follow Apple's own localization for each locale so the instruction names
// the pane the user is actually looking at.

export const CONSENT_SURFACE_KEY_OVERRIDES = {
  'auto.components.BrowserPane.streamCapabilityUnsupported': {
    es: 'El entorno de ejecución seleccionado no admite la transmisión remota del navegador.'
  },

  // ── Permission status labels ─────────────────────────────────────────────
  'auto.components.settings.DeveloperPermissionsPane.statusGranted': {
    es: 'Concedido'
  },
  'auto.components.settings.DeveloperPermissionsPane.statusDenied': {
    es: 'Denegado'
  },
  'auto.components.settings.DeveloperPermissionsPane.statusNotRequested': {
    es: 'No solicitado'
  },
  'auto.components.settings.DeveloperPermissionsPane.statusRestricted': {
    es: 'Restringido'
  },
  'auto.components.settings.DeveloperPermissionsPane.statusUnsupported': {
    es: 'Solo macOS'
  },
  'auto.components.settings.DeveloperPermissionsPane.statusEntitled': {
    es: 'Con permiso'
  },
  'auto.components.settings.DeveloperPermissionsPane.statusCheckManually': {
    es: 'Comprobar manualmente'
  },
  'auto.components.settings.DeveloperPermissionsPane.statusManagedByMacOS': {
    es: 'Gestionado por macOS'
  },

  // ── Permission actions ───────────────────────────────────────────────────
  'auto.components.settings.DeveloperPermissionsPane.actionRequest': {
    es: 'Solicitar'
  },
  'auto.components.settings.DeveloperPermissionsPane.actionRequestAccess': {
    es: 'Solicitar acceso'
  },
  'auto.components.settings.DeveloperPermissionsPane.actionTriggerPrompt': {
    es: 'Provocar el aviso'
  },
  'auto.components.settings.DeveloperPermissionsPane.actionOpenSettings': {
    es: 'Abrir Ajustes'
  },
  'auto.components.settings.DeveloperPermissionsPane.localNetworkOpenSettings': {
    es: 'Abrir Ajustes del Sistema'
  },
  'auto.components.settings.DeveloperPermissionsPane.localNetworkOpenSystemSettings': {
    es: 'Abrir Ajustes del Sistema'
  },
  'auto.components.settings.DeveloperPermissionsPane.openSettingsFailed': {
    es: 'No se pudieron abrir los Ajustes del Sistema'
  },

  // ── Local Network prompt guidance ────────────────────────────────────────
  'auto.components.settings.DeveloperPermissionsPane.localNetworkPromptCheck': {
    es: 'Buscar un aviso de macOS'
  },
  'auto.components.settings.DeveloperPermissionsPane.localNetworkPromptGuidance': {
    es: 'Si aparece un aviso, elige Permitir. Si no aparece ninguno, abre Ajustes del Sistema y activa Orca Lab en Privacidad y seguridad → Red local.'
  },

  // ── Local Network connection test ────────────────────────────────────────
  'auto.components.settings.DeveloperPermissionsPane.connectionTestTitle': {
    es: 'Probar la conexión'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestAction': {
    es: 'Probar conexión'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestDescription': {
    es: 'Indica un servicio de otro dispositivo de tu red local. Orca Lab prueba la misma ruta de red que usan las herramientas de terminal.'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestHost': {
    es: 'Host'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestPort': {
    es: 'Puerto'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestRunning': {
    es: 'Probando...'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestLastVerified': {
    es: 'Última comprobación'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestNotYetVerified': {
    es: 'No hay ninguna prueba correcta guardada.'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestInvalidTarget': {
    es: 'Indica un nombre de host o una IP privada de tu red y un puerto entre 1 y 65535.'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestFailed': {
    es: 'No se pudo completar la prueba de conexión.'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestRefused': {
    es: 'El host respondió, pero el puerto rechazó la conexión.'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestTimeout': {
    es: 'Se agotó el tiempo de conexión. Comprueba el destino, el servicio y los ajustes de Red local de macOS.'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestUnreachable': {
    es: 'No se pudo alcanzar el destino.'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestUnresolved': {
    es: 'No se pudo resolver el nombre de host.'
  },
  'auto.components.settings.DeveloperPermissionsPane.connectionTestUnsupported': {
    es: 'La prueba de conexión está disponible en la app de escritorio de macOS.'
  },

  // ── Release channel warnings ─────────────────────────────────────────────
  'auto.components.settings.ReleaseChannelSection.hourlyWarning': {
    es: 'Las compilaciones horarias son solo para macOS y salen directamente de main sin pasar por ningún test. Ten a mano una compilación estable.'
  },
  'auto.components.settings.ReleaseChannelSection.dailyWarning': {
    es: 'Las compilaciones diarias son solo para macOS y salen directamente de main sin pasar por ningún test. Ten a mano una compilación estable.'
  },
  'auto.components.settings.ReleaseChannelSection.adhocWarning': {
    es: 'Las compilaciones adhoc son solo para macOS y provienen de una rama que aún no se ha integrado. Quien la generó puede abandonarla: ten a mano una compilación estable.'
  }
}
