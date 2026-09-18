/** Campos de una fila declarada por un plugin que son del plugin, no del
 *  usuario: exactamente lo que `contributes.automations` declara (menos su
 *  `id`, que es identidad). El timeout del precheck no esta: lo declara Orca. */
export type AutomationPluginManagedField =
  | 'name'
  | 'prompt'
  | 'precheck'
  | 'agentId'
  | 'rrule'
  | 'timezone'
  /** Solo para declaraciones con `workspace: 'plugin-owned'`: el repo de la
   *  carpeta del plugin. Para el resto el plugin no declara destino y el campo
   *  vale `null`, que es el comportamiento de siempre. */
  | 'runTarget'

/** Huella de cada campo del plugin tal como lo escribio la ultima
 *  reconciliacion. Asi una reconciliacion posterior distingue su propia
 *  escritura de una edicion del usuario. Parcial: una fila anterior a esta
 *  feature no tiene huellas, y un campo nuevo tampoco la tiene todavia. */
export type AutomationPluginManagedFingerprints = Partial<
  Record<AutomationPluginManagedField, string>
>

/** Identity of the plugin that declared an automation, and of the declaration
 *  inside its manifest. El host es dueno del ciclo de vida de esa fila: se crea
 *  al habilitar el plugin y se borra al deshabilitarlo o desinstalarlo. */
export type AutomationPluginOrigin = {
  pluginKey: string
  automationId: string
  managedFingerprints?: AutomationPluginManagedFingerprints
  /** Campos del plugin que la ultima reconciliacion encontro editados aca y
   *  dejo intactos: lo que `orca automations show` reporta como ya no seguidos. */
  userEditedFields?: readonly AutomationPluginManagedField[]
}
