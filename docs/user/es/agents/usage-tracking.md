---
sourceHash: cf489f89b4dcaace
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

## Tokens de larga duración

El inicio de sesión de una cuenta de Claude rota, y un inicio de sesión que termina en un host puede
cerrar la sesión de los agentes en otro. Un token de larga duración de `claude setup-token` dura
alrededor de un año y nunca rota.

1. En el host que ejecuta los agentes, con la sesión iniciada en esa cuenta, ejecuta `claude setup-token`.
2. Abre **Settings > AI Provider Accounts > Claude**, elige **Token** en la fila de la cuenta, pega
   el token y elige **Save token**. Desde una terminal, `orca account token set --account <email|id>`
   lo lee de un prompt oculto.
3. Reinicia las terminales de Claude activas en esa cuenta para que lo usen.

- Cada lanzamiento en esa cuenta usa el token, no el inicio de sesión guardado. Un inicio de sesión
  guardado que falló o terminó ya no impide lanzar en una cuenta con token.
- Un token pertenece a una cuenta en un host. Configúralo en cada host, desde ese host.
- El token solo hace solicitudes al modelo: Remote Control y los conectores de claude.ai no funcionan
  con él. El uso y la comprobación de inicio de sesión siguen saliendo del inicio de sesión guardado.
- La fila muestra una insignia **Token** y una línea con el estado del token, su vencimiento estimado
  y el estado del inicio de sesión guardado. **Check sign-in** también pregunta a Anthropic si el token
  sigue funcionando.
- Las cuentas en WSL y las cuentas con un endpoint personalizado todavía no pueden usar un token.
- **Remove token**, u `orca account token clear --account <email|id>`, vuelve al inicio de sesión
  guardado.

```bash
orca account token set --account me@example.com
orca account token clear --account me@example.com
```

## Dónde se guardan las credenciales

Las credenciales administradas de Claude y Codex permanecen en tu dispositivo, en la carpeta de datos de Orca Lab.
En macOS, las credenciales de Claude también se guardan en el Llavero con el nombre "Orca Claude Code Managed
Credentials". Un token de larga duración se guarda en la configuración propia de esa cuenta, en el host
donde lo configuraste.

Para ver qué solicitudes hace Orca Lab para el uso y el inicio de sesión, consulta [Telemetría y privacidad](../telemetry.md).
