---
sourceHash: 297a9fa57f90cee8
---
# Telemetría y privacidad

Esta página describe los datos de uso que Orca Lab puede enviar, cuándo los envía y a dónde.

## Los builds de este repositorio no envían telemetría

La telemetría solo se transmite desde los builds de release oficiales que el pipeline de release firma con una
identidad de build y una clave de escritura. El workflow de release de este repositorio no define ninguna de las
dos, así que los builds hechos a partir de él no envían eventos de uso.

Los builds de desarrollo y de colaboradores nunca envían telemetría.

## Cuando la telemetría está activada

Si la telemetría está habilitada en un build oficial:

- Los eventos van a PostHog en `https://us.i.posthog.com`.
- Cada evento incluye la versión de la app, la plataforma, la arquitectura, la versión del sistema operativo, un ID
  de instalación aleatorio, un ID de sesión que cambia en cada arranque y el canal de release.
- Los eventos son una lista fija de acciones con nombre, como los pasos del onboarding, los lanzamientos de agentes
  y los cambios de configuración. Cada evento tiene un esquema estricto. Cualquier evento con campos inesperados se descarta.
- No se envían prompts, contenidos de archivos, nombres de repositorios, rutas ni URL. La única excepción es un
  error de instalación de un hook de agente, que puede incluir un mensaje de error abreviado.
- Los eventos no están vinculados al perfil de ninguna persona.

## Desactivar la telemetría

- Abre **Settings > Privacy & Telemetry** y desactiva **Share anonymous usage data**.
- O define la variable de entorno `DO_NOT_TRACK=1`, o `ORCA_TELEMETRY_DISABLED`, antes de iniciar Orca Lab.
- La telemetría también está desactivada cuando está definida una variable de entorno de CI.

Cuando desactivas la telemetría, Orca Lab envía un último evento que registra la exclusión y luego se detiene.

El ID de instalación aleatorio se guarda en el archivo de datos de Orca Lab en tu máquina.

## Otras solicitudes de red

Orca Lab hace estas solicitudes para las funciones que usas. Ninguna de ellas envía telemetría:

- **Comprobación de actualizaciones:** Orca Lab consulta a GitHub si hay releases nuevos, cada 24 horas.
- **Lista de bloqueo de plugins:** Orca Lab descarga una lista de plugins deshabilitados desde `onorca.dev`, en los builds empaquetados.
- **Uso e inicio de sesión:** las solicitudes de uso y de renovación de tokens de Claude y Codex van a los
  endpoints de los propios proveedores. Consulta [Seguimiento de uso y cuentas](agents/usage-tracking.md).
- **Compartir artifacts:** un artifact compartido se sube cuando lo compartes.
- **SSH:** Orca Lab se conecta a los hosts que configuras. Consulta [SSH](ssh.md).
