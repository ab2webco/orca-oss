---
sourceHash: d5cc25d024732969
---
# Seguimiento de uso y cuentas

Orca Lab muestra qué parte de su límite de tasa han consumido tus cuentas de Claude y Codex, y te permite cambiar entre
cuentas sin volver a iniciar sesión.

## Uso

- Orca Lab comprueba el uso de Claude y Codex cada 15 minutos de forma predeterminada, y nunca más de una vez cada 30 segundos.
- Usa **Refresh rate limits** para comprobarlo ahora.
- El uso de Claude se solicita al endpoint de uso de Anthropic con el token OAuth de tu cuenta. Si esa solicitud falla, Orca Lab ejecuta `claude` en una terminal oculta y lee la salida de `/usage`.
- El uso de Codex se lee del servidor local de la app de Codex, o de la salida de `/status`, y del endpoint de uso de OpenAI.
- **Reset now** en una cuenta de Codex gasta uno de tus créditos de reinicio. Orca Lab pide confirmación antes.
- **Claude Usage Tracking** y **Codex Usage Tracking** también cuentan la actividad de las sesiones locales a partir de los archivos de log del agente en tu máquina.

Las cuentas que usan un endpoint personalizado no tienen seguimiento de uso.

## Cambiar de cuenta

- Usa **Switch to** en la lista de cuentas, o `orca account switch --to <email|id>` desde la CLI.
- El cambio está disponible para las cuentas de Claude desde la CLI. En Claude, la misma terminal se vuelve a lanzar y retoma la misma conversación. Si el relanzamiento falla, Orca Lab restaura la cuenta anterior.
- El cambio automático no está disponible para las terminales SSH, porque las credenciales de la cuenta están en el host remoto.
- Para cambiar una terminal en un host emparejado, indica la terminal y el host: `orca account switch --to <email|id> --terminal <handle> --environment <host>`. El destino es una de las propias cuentas de ese host.
- `orca account list` muestra la cuota en caché. Nunca imprime credenciales.

## Dónde se guardan las credenciales

Las credenciales administradas de Claude y Codex permanecen en tu dispositivo, en la carpeta de datos de Orca Lab.
En macOS, las credenciales de Claude también se guardan en el Llavero con el nombre "Orca Claude Code Managed
Credentials".

Para ver qué solicitudes hace Orca Lab para el uso y el inicio de sesión, consulta [Telemetría y privacidad](../telemetry.md).
