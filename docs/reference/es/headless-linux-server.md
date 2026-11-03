---
sourceHash: 26d0c07465130872
---
# Servidor Linux sin interfaz gráfica

Usa esta guía cuando quieras ejecutar `orca serve` en una máquina Linux sin
sesión de escritorio, como un VPS con Ubuntu o una máquina remota de compilación.

`orca serve` inicia el runtime de Orca sin abrir la ventana de escritorio. En
Linux, el AppImage empaquetado sigue necesitando las bibliotecas que Electron
espera al arrancar. Las builds actuales de Orca inician Xvfb automáticamente para
`orca serve` cuando no hay `DISPLAY` definido, pero antes hay que instalar Xvfb.
No se necesita una sesión de D-Bus aparte. Cuando `DISPLAY` está definido, Orca
usa ese display en lugar de iniciar un proceso Xvfb que compita con él.

La matriz de despliegue soportada cubre Ubuntu 20.04, 22.04 y 24.04 y la versión
estable actual de Debian: cualquier sistema con glibc 2.31 o posterior (consulta
[Compatibilidad de glibc en Linux](../linux-glibc-compatibility.md)). Los nombres de
los paquetes pueden variar en otras distribuciones derivadas de Debian.

## Requisitos previos en Ubuntu y Debian

Instala la dependencia de runtime del AppImage y Xvfb:

```bash
sudo apt-get update
sudo apt-get install -y curl file jq xvfb zlib1g-dev
```

En Ubuntu 22.04, instala `libfuse2` para ejecutar el AppImage mediante FUSE. En
Ubuntu 24.04 y Debian, el paquete equivalente puede ser `libfuse2t64`. FUSE es
opcional: sin él, usa la vía de extracción que soporta el AppImage:

```bash
cd /opt/orca
./orca-linux.AppImage --appimage-extract
/opt/orca/squashfs-root/AppRun serve --port 6768
```

En Docker normalmente no hay dispositivo FUSE. Usa `--appimage-extract` una vez o
`--appimage-extract-and-run`; ninguno de los dos requiere un contenedor con
privilegios. El wrapper de extract-and-run puede imprimir las rutas extraídas antes
de que Orca arranque, así que la automatización que necesite que stdout contenga
solo el JSON de arranque listo debe extraer una vez e invocar `squashfs-root/AppRun`.

Descarga el AppImage y hazlo ejecutable:

```bash
sudo mkdir -p /opt/orca
sudo curl -L https://github.com/stablyai/orca/releases/latest/download/orca-linux.AppImage \
  -o /opt/orca/orca-linux.AppImage
sudo chmod +x /opt/orca/orca-linux.AppImage
```

Si `Xvfb` se instaló en otro lugar que no sea `/usr/bin`, confirma que systemd
podrá encontrarlo más adelante:

```bash
command -v Xvfb
```

## Ejecución en primer plano

Empieza con una ejecución en primer plano antes de crear un servicio:

```bash
LIBGL_ALWAYS_SOFTWARE=1 /opt/orca/orca-linux.AppImage serve --port 6768
```

Para clientes remotos, pasa la dirección que deben usar para llegar a este
servidor. Una dirección de Tailscale suele ser la opción más segura para
servidores privados:

```bash
LIBGL_ALWAYS_SOFTWARE=1 /opt/orca/orca-linux.AppImage serve \
  --port 6768 \
  --pairing-address 100.64.1.20
```

`--pairing-address` es solo la dirección que se anuncia a los clientes. No cambia
la dirección de bind del listener. Orca hace bind de su listener WebSocket y luego
combina el puerto realmente enlazado con el host anunciado cuando la dirección no
incluye puerto. Usa un hostname o IP alcanzable por LAN/Tailscale, o una URL
completa de reverse proxy como `https://orca.example.com/runtime` (`http(s)` se
normaliza a `ws(s)`). Las direcciones comodín como `*`, `0.0.0.0` y `::` no se
pueden anunciar.

El comando escribe en stdout un bloque de arranque listo cuando terminan el bind del
listener y la inicialización del emparejamiento:

```text
Orca server ready
Bound endpoint: ws://0.0.0.0:6768
Advertised endpoint: ws://100.64.1.20:6768
Pairing URL: orca://pair?code=...
```

Para supervisores, pide el contrato JSON versionado de una sola línea:

```bash
/opt/orca/orca-linux.AppImage serve --port 6768 \
  --pairing-address 100.64.1.20 --json
```

La salida real es una sola línea compacta; este ejemplo está formateado para que
se lea mejor:

```json
{
  "type": "orca_server_ready",
  "schemaVersion": 1,
  "runtimeId": "...",
  "endpoint": "ws://0.0.0.0:6768",
  "boundEndpoint": "ws://0.0.0.0:6768",
  "advertisedEndpoint": "ws://100.64.1.20:6768",
  "managedWslCliReconciliation": "settled",
  "pairing": {
    "available": true,
    "url": "orca://pair?code=...",
    "endpoint": "ws://100.64.1.20:6768",
    "deviceId": "...",
    "webClientUrl": "...",
    "scope": "runtime",
    "qr": null
  }
}
```

`endpoint` se mantiene como alias de compatibilidad de `boundEndpoint`; la
automatización nueva debe usar los campos explícitos de endpoint enlazado y anunciado.

Cuando el servidor sigue siendo utilizable pero no puede generar una oferta,
`pairing` sigue siendo un objeto con `available:false`, un `reason` estable y una
`guidance` para el operador; nunca se omite en silencio. `--recipe-json` es más
estricto y termina con ese motivo, porque su contrato exige una URL de
emparejamiento. Detén un servidor en primer plano con `Ctrl+C`. Los motivos
estables son `disabled_by_operator`, `websocket_unavailable`,
`device_registry_unavailable`, `e2ee_key_unavailable` e
`invalid_advertised_endpoint`.

## Servicio de systemd

Crea un usuario de servicio dedicado y un directorio de instalación. Ejecuta el
servicio con ese usuario en lugar de root para que el AppImage pueda mantener
activado el sandbox de Chromium. Deja el directorio de instalación como propiedad
de root: el servicio necesita leer y ejecutar el AppImage, pero no debe poder
reemplazarlo ni reemplazar los artefactos de rollback.

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin orca
sudo chown root:root /opt/orca /opt/orca/orca-linux.AppImage
sudo chmod 755 /opt/orca /opt/orca/orca-linux.AppImage
```

En la mayoría de los hosts basta con un servicio `orca serve`, porque Orca inicia
Xvfb en el display `:99` cuando no existe ningún display:

```ini
# /etc/systemd/system/orca-serve.service
[Unit]
Description=Orca runtime server
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=orca
WorkingDirectory=/home/orca
Environment=LIBGL_ALWAYS_SOFTWARE=1
ExecStart=/opt/orca/orca-linux.AppImage serve --port 6768 --pairing-address 100.64.1.20
StandardOutput=journal
StandardError=journal
KillMode=mixed
Restart=on-failure
RestartPreventExitStatus=3
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Reemplaza `100.64.1.20` por el hostname de LAN, Tailscale, túnel o público que
deben usar los clientes.

`KillMode=mixed` envía la señal de detención ordenada solo al proceso principal
de Orca y conserva el `SIGKILL` de respaldo de systemd para todo el cgroup si el
apagado excede el tiempo límite. Así Orca puede mantener vivo su propio Xvfb hasta
que Electron se desconecte limpiamente.

El código de salida `3` significa que otro proceso ya es dueño de este perfil de
userData, así que `RestartPreventExitStatus=3` detiene la unidad en lugar de
reintentar un arranque que no puede salir bien. Cualquier otra falla permanente
de arranque se limita a 5 arranques cada 5 minutos; los valores por defecto de
systemd (ventana de 10 s, 5 arranques) nunca se disparan con `RestartSec=5`, y así
es como un arranque defectuoso podía reiniciarse miles de veces. El límite de
arranques también cuenta los arranques que inicia el operador, así que, una vez
que se dispara, systemd rechaza un `systemctl start` simple hasta que pasa la
ventana de 5 minutos. Ejecuta primero `sudo systemctl reset-failed orca-serve.service`
para limpiarlo; los scripts de [Actualización](#pasos-de-actualización) y de
[Rollback](#rollback) ya lo hacen. En versiones de systemd anteriores a la 230,
esas dos directivas se escriben `StartLimitInterval=`/`StartLimitBurst=` y van en
`[Service]`; Ubuntu 20.04, la base más antigua que soporta Orca, trae systemd 245.

Activa el servicio:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now orca-serve.service
sudo journalctl -u orca-serve.service -f
```

`journalctl -o cat` quita los metadatos del journal, pero sigue mezclando el
stdout y el stderr del servicio. Interpreta cada línea como JSON y exige el tipo
y el esquema de arranque listo antes de considerar que el servicio está listo:

```bash
sudo journalctl -u orca-serve.service -o cat \
  | jq -Rrc 'fromjson? | select(.type == "orca_server_ready" and .schemaVersion == 1)'
```

Un health check acotado debe exigir ese contrato dentro de su tiempo límite de
arranque; si no aparece, revisa los diagnósticos anteriores para encontrar el
motivo exacto del emparejamiento, el error del listener o la biblioteca que falta.

## Servicio de Xvfb administrado

Si prefieres que systemd controle el ciclo de vida del display virtual, ejecuta
Xvfb como un servicio aparte y define `DISPLAY=:99` para Orca.

```ini
# /etc/systemd/system/orca-xvfb.service
[Unit]
Description=Virtual X display for Orca
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Si `command -v Xvfb` devolvió otra ruta, cambia `ExecStart` a esa ruta absoluta.

Luego agrega la dependencia del display al servicio de Orca:

```ini
# /etc/systemd/system/orca-serve.service
[Unit]
Description=Orca runtime server
After=network-online.target orca-xvfb.service
Wants=network-online.target orca-xvfb.service
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=orca
WorkingDirectory=/home/orca
Environment=DISPLAY=:99
Environment=LIBGL_ALWAYS_SOFTWARE=1
ExecStart=/opt/orca/orca-linux.AppImage serve --port 6768 --pairing-address 100.64.1.20
Restart=on-failure
RestartPreventExitStatus=3
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Activa ambas unidades:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now orca-xvfb.service orca-serve.service
```

## Nota sobre la instalación de la CLI

En un host sin interfaz gráfica no necesitas abrir la UI de escritorio solo para
ejecutar el servidor. Invoca el AppImage directamente:

```bash
/opt/orca/orca-linux.AppImage serve --help
```

Ejecutar un AppImage como root requiere el flag `--no-sandbox` de Chromium antes
del comando:

```bash
/opt/orca/orca-linux.AppImage --no-sandbox serve --port 6768
```

Esto desactiva una barrera de seguridad. Prefiere un usuario de servicio dedicado
y sin privilegios, sobre todo cuando el listener es alcanzable más allá de
localhost.

## Solución de problemas de emparejamiento

- Una oferta de emparejamiento es una capability que contiene una credencial de
  dispositivo y material E2EE. Compártela solo con el cliente previsto y no la
  dejes en los logs de acceso del proxy.
- `boundEndpoint` es donde escucha el proceso; `advertisedEndpoint` es a donde se
  conecta el cliente. Una oferta que parece válida no puede conectar si el DNS,
  el firewall, la publicación de puertos de Docker, la política de Tailscale o un
  reverse proxy no enrutan el endpoint anunciado al puerto enlazado.
- Si se omite el puerto anunciado, se usa el puerto realmente enlazado, incluido
  un puerto alternativo elegido tras una colisión. Un puerto de proxy explícito se
  conserva. Por lo tanto, una discrepancia de puertos significa que el enrutamiento
  externo proporcionado está mal, no que Orca lo cambie.
- Los reverse proxies deben soportar el upgrade a WebSocket y enrutar la ruta
  anunciada. Usa `wss://` o `https://` cuando TLS termina en el proxy; no anuncies
  `ws://` a través de un endpoint que solo acepta HTTPS.
- Se soportan hostnames, IPv4, IPv6 entre corchetes y literales IPv6 sin corchetes.
  IPv6 sigue requiriendo un listener y una ruta de red alcanzables por IPv6.
- `xvfb-run` y `dbus-run-session -- xvfb-run` siguen siendo formas válidas de
  arrancar para diagnóstico, pero ninguna debería hacer falta cuando `Xvfb` está
  instalado y no hay display configurado. Mensajes de D-Bus repetidos sin un bloque
  de arranque listo indican que el arranque no llegó al modo serve; confirma la versión del
  AppImage y el orden exacto de los argumentos, sobre todo `--no-sandbox serve`.

Si más adelante instalas la CLI de escritorio desde la configuración de Orca, usa
esa CLI para los flujos normales en el shell. Mantén la ruta del AppImage en
systemd para que los reinicios del servicio no dependan de un perfil de shell
interactivo.

## Actualización

`orca serve` nunca se actualiza solo. En modo sin interfaz gráfica, Orca no conecta
ningún actualizador automático: el actualizador integrado solo corre en la GUI de
escritorio, y ningún cliente móvil o web emparejado puede dispararlo de forma
remota. Actualizar siempre es un paso deliberado: reemplaza el AppImage y reinicia
el servicio.

Dos hechos hacen que esto sea seguro y predecible:

- **El estado vive en el home del usuario del servicio, no junto al binario.** Los
  datos persistidos están en `/home/orca/.config/` (Orca usa ahí un directorio
  `orca` y otro `Orca`), totalmente independientes de `/opt/orca/orca-linux.AppImage`.
  Reemplazar el binario nunca toca los proyectos, los metadatos de los worktrees,
  el historial de la terminal, el estado de orquestación ni las claves de los
  dispositivos emparejados, así que los clientes móviles y web se reconectan
  después de una actualización sin volver a emparejarse.
- **Las builds nuevas migran el estado antiguo al cargarlo.** Orca carga el estado
  de un `orca-data.json` antiguo en el esquema actual y lo vuelve a escribir con la
  forma actual, así que una actualización hacia adelante no necesita ningún paso
  manual sobre los datos.

El rollback es el caso que requiere cuidado; consulta [Rollback](#rollback).

### Registra la versión que despliegas

Orca no tiene un comando de versión en modo sin interfaz gráfica: no hay flag
`--version` ni subcomando `version`, y `orca serve` solo imprime su endpoint. Elige
un tag de release de forma explícita en lugar de seguir la URL `latest`, y
regístralo junto al binario para que las actualizaciones se puedan auditar. Los
pasos siguientes guardan ese registro en `/opt/orca/VERSION`.

### Pasos de actualización

Nunca descargues directamente sobre `/opt/orca/orca-linux.AppImage`. El AppImage
está montado con FUSE, así que sobrescribirlo directamente mientras el servicio
corre puede hacer fallar o corromper el proceso en ejecución; e incluso con el
servicio detenido, una descarga fallida o parcial destruiría el binario que
funciona. En su lugar, descarga a un nombre temporal en el mismo sistema de
archivos, verifícalo y luego colócalo con un rename atómico.

Comprueba el espacio disponible antes de empezar:

```bash
sudo chown root:root /opt/orca
sudo chmod 755 /opt/orca
sudo test ! -L /opt/orca/orca-linux.AppImage
sudo chown root:root /opt/orca/orca-linux.AppImage
sudo chmod 755 /opt/orca/orca-linux.AppImage
# Clear predictable staging names left by an older attempt after locking the directory
sudo rm -f /opt/orca/orca-linux.AppImage.new /opt/orca/VERSION.new \
  /opt/orca/orca-linux.AppImage.recovering /opt/orca/VERSION.recovering
sudo du -sh /home/orca/.config
df -h /opt/orca /home/orca
```

`/opt/orca` necesita espacio para el archivo comprimido del perfil de Orca, la
build preparada y el binario de rollback. Un rollback extrae el perfil antiguo y
conserva los directorios de perfil de Orca posteriores a la actualización, así que
`/home` necesita espacio para ambas copias.

Ejecuta el siguiente bloque como un solo script de Bash para que sus traps de
fail-fast y de recuperación sigan activos durante toda la operación:

```bash
set -euo pipefail

# Replace this example with the release tag you intend to deploy
ORCA_VERSION=v1.4.147

# Select the release asset on the server where Orca runs
case "$(uname -m)" in
  x86_64)
    ORCA_ASSET=orca-linux.AppImage
    ORCA_FILE_MACHINE=x86-64
    ;;
  aarch64 | arm64)
    ORCA_ASSET=orca-linux-arm64.AppImage
    ORCA_FILE_MACHINE='ARM aarch64'
    ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

ORCA_ROLLBACK_NEW=
ORCA_ROLLBACK=
ORCA_SERVICE_STOPPED=0
ORCA_BINARY_PROMOTED=0
recover_failed_upgrade() {
  exit_status=$?
  trap - EXIT
  set +e
  if ((exit_status != 0)); then
    sudo rm -f /opt/orca/orca-linux.AppImage.new /opt/orca/VERSION.new \
      /opt/orca/orca-linux.AppImage.recovering /opt/orca/VERSION.recovering
  fi
  if ((exit_status != 0)) && [[ -n "$ORCA_ROLLBACK_NEW" ]] && \
    sudo test -d "$ORCA_ROLLBACK_NEW"; then
    sudo rm -rf -- "$ORCA_ROLLBACK_NEW"
  fi
  if ((exit_status != 0 && ORCA_SERVICE_STOPPED)); then
    recovery_ok=1
    if ((ORCA_BINARY_PROMOTED)); then
      if ! sudo cp -a "$ORCA_ROLLBACK/orca-linux.AppImage" \
        /opt/orca/orca-linux.AppImage.recovering || \
        ! sudo mv -f /opt/orca/orca-linux.AppImage.recovering \
          /opt/orca/orca-linux.AppImage; then
        recovery_ok=0
      fi
      if sudo test -f "$ORCA_ROLLBACK/VERSION"; then
        if ! sudo cp -a "$ORCA_ROLLBACK/VERSION" /opt/orca/VERSION.recovering || \
          ! sudo mv -f /opt/orca/VERSION.recovering /opt/orca/VERSION; then
          recovery_ok=0
        fi
      elif ! sudo rm -f /opt/orca/VERSION; then
        recovery_ok=0
      fi
    fi
    sudo rm -f /opt/orca/orca-linux.AppImage.recovering \
      /opt/orca/VERSION.recovering
    if ((recovery_ok)); then
      # A tripped StartLimitBurst refuses a plain start
      sudo systemctl reset-failed orca-serve.service || true
      sudo systemctl start orca-serve.service || true
    else
      echo 'Upgrade recovery failed; service remains stopped' >&2
    fi
  fi
  exit "$exit_status"
}
trap recover_failed_upgrade EXIT

# 1. Stage and verify the new build while the server stays online
sudo curl -fL --retry 3 "https://github.com/stablyai/orca/releases/download/${ORCA_VERSION}/${ORCA_ASSET}" \
  -o /opt/orca/orca-linux.AppImage.new
sudo chown root:root /opt/orca/orca-linux.AppImage.new
sudo chmod 755 /opt/orca/orca-linux.AppImage.new

# Both checks must match; either grep stops this fail-fast block otherwise
ORCA_FILE_INFO=$(LC_ALL=C file /opt/orca/orca-linux.AppImage.new)
grep 'ELF .* executable' <<<"$ORCA_FILE_INFO"
grep -F "$ORCA_FILE_MACHINE" <<<"$ORCA_FILE_INFO"

# 2. Assemble the prior binary and version in a root-only rollback bundle
ORCA_ROLLBACK_BASE=/opt/orca/orca-rollback-$(date +%F-%H%M%S-%N)
ORCA_ROLLBACK_NEW=${ORCA_ROLLBACK_BASE}.new
ORCA_ROLLBACK=${ORCA_ROLLBACK_BASE}.ready
sudo install -d -m 700 "$ORCA_ROLLBACK_NEW"
sudo cp -a /opt/orca/orca-linux.AppImage "$ORCA_ROLLBACK_NEW/orca-linux.AppImage"
if sudo test -f /opt/orca/VERSION; then
  sudo cp -a /opt/orca/VERSION "$ORCA_ROLLBACK_NEW/VERSION"
fi

# Stage the new version record before the stop window
printf '%s\n' "$ORCA_VERSION" | sudo tee /opt/orca/VERSION.new >/dev/null
sudo chown root:root /opt/orca/VERSION.new
sudo chmod 644 /opt/orca/VERSION.new

# 3. Stop the server so the profile backup is consistent
ORCA_SERVICE_STOPPED=1
sudo systemctl stop orca-serve.service

# Add only Orca-owned profile directories, then publish the complete bundle
ORCA_PROFILE_DIRS=()
for profile_dir in orca Orca; do
  if sudo test -L "/home/orca/.config/$profile_dir"; then
    echo "Refusing symlinked Orca profile: /home/orca/.config/$profile_dir" >&2
    exit 1
  fi
  if sudo test -d "/home/orca/.config/$profile_dir"; then
    if [[ "$profile_dir" == Orca ]] && \
      sudo test /home/orca/.config/orca -ef /home/orca/.config/Orca; then
      continue
    fi
    ORCA_PROFILE_DIRS+=("$profile_dir")
  fi
done
if ((${#ORCA_PROFILE_DIRS[@]} == 0)); then
  echo 'No Orca profile directory found under /home/orca/.config' >&2
  exit 1
fi
sudo tar czf "$ORCA_ROLLBACK_NEW/profile.tgz" \
  -C /home/orca/.config "${ORCA_PROFILE_DIRS[@]}"
sudo chmod 600 "$ORCA_ROLLBACK_NEW/profile.tgz"
sudo mv "$ORCA_ROLLBACK_NEW" "$ORCA_ROLLBACK"

# 4. Atomically replace the binary and version record, then start
ORCA_BINARY_PROMOTED=1
sudo mv -f /opt/orca/orca-linux.AppImage.new /opt/orca/orca-linux.AppImage
sudo mv -f /opt/orca/VERSION.new /opt/orca/VERSION
# Clears a start-limit hit left by the version being replaced
sudo systemctl reset-failed orca-serve.service
sudo systemctl start orca-serve.service
ORCA_SERVICE_STOPPED=0
trap - EXIT
```

El archivo del perfil creado en el paso 3 captura ambos nombres de directorio de
perfil de Orca cuando existen, sin revertir otras herramientas que no
tienen relación bajo `/home/orca/.config`. El sufijo `.ready` se publica solo
cuando el binario anterior, el registro de versión y el archivo del perfil están
completos. Si usas la unidad de Xvfb administrada, solo hay que reiniciar
`orca-serve.service`; deja `orca-xvfb.service` en ejecución.

### Verificación

```bash
sudo journalctl -u orca-serve.service -f
```

Un arranque correcto imprime un bloque `Orca server ready` con los endpoints
realmente enlazado y anunciado. Verifica esos valores en lugar de dar por hecho el
puerto configurado, porque una colisión puede seleccionar un puerto alternativo.
Confirma que un cliente se reconecta antes de descartar el respaldo. Los paquetes
de rollback con marca de tiempo no se eliminan automáticamente. Cuando la nueva
versión cumpla tu política de retención, selecciona e inspecciona el paquete
completo más reciente antes de eliminarlo:

```bash
shopt -s nullglob
ORCA_ROLLBACK_SETS=(/opt/orca/orca-rollback-*.ready)
((${#ORCA_ROLLBACK_SETS[@]} > 0))
ORCA_ROLLBACK=${ORCA_ROLLBACK_SETS[${#ORCA_ROLLBACK_SETS[@]} - 1]}
printf 'Removing rollback bundle: %s\n' "$ORCA_ROLLBACK"
sudo test -d "$ORCA_ROLLBACK"
sudo rm -rf -- "$ORCA_ROLLBACK"
```

Cada directorio `.ready` es una generación de rollback autocontenida; nunca
combines archivos de paquetes distintos.

### Rollback

Un rollback **no** es seguro si solo cambias el binario. Una vez que un build más
nuevo ha arrancado, puede reescribir `orca-data.json` en el esquema actual. Si
después un build más antiguo escribe ese archivo, puede descartar campos que no
reconoce. Los archivos rotativos `orca-data.json.bak.*` son instantáneas para
recuperarse de corrupción, no una copia dedicada previa a la actualización, y las
escrituras normales pueden rotarlos hasta hacerlos desaparecer. Para hacer un
rollback limpio, restaura el respaldo del paso 3 **y** vuelve a poner el binario
anterior. Ejecuta este bloque como un solo script de Bash:

```bash
set -euo pipefail

# Select and validate one complete generation before taking the service offline
shopt -s nullglob
ORCA_ROLLBACK_SETS=(/opt/orca/orca-rollback-*.ready)
((${#ORCA_ROLLBACK_SETS[@]} > 0))
ORCA_ROLLBACK=${ORCA_ROLLBACK_SETS[${#ORCA_ROLLBACK_SETS[@]} - 1]}
sudo test -f "$ORCA_ROLLBACK/orca-linux.AppImage"
sudo tar tzf "$ORCA_ROLLBACK/profile.tgz" >/dev/null

# Extract and validate the old profile while the current server stays online
sudo test ! -L /home
ORCA_HOME_OWNER=$(sudo stat -c %u /home)
ORCA_HOME_MODE=$(sudo stat -c %a /home)
if [[ "$ORCA_HOME_OWNER" != 0 ]] || ((8#$ORCA_HOME_MODE & 0022)) || \
  sudo -u orca test -w /home; then
  echo 'Refusing rollback because /home is not root-controlled' >&2
  exit 1
fi
ORCA_RESTORE=$(sudo mktemp -d /home/.orca-restore.XXXXXX)
ORCA_SERVICE_STOPPED=0
ORCA_MOVED_CURRENT_DIRS=()
ORCA_INSTALLED_RESTORE_DIRS=()
ORCA_CURRENT_BINARY_MOVED=0
ORCA_CURRENT_VERSION_MOVED=0
ORCA_VERSION_REPLACEMENT_STARTED=0
ORCA_POST_UPGRADE=
ORCA_ROLLBACK_BINARY_STAGED=
ORCA_ROLLBACK_VERSION_STAGED=
ORCA_ROLLBACK_HAS_VERSION=0
restart_after_rollback_error() {
  exit_status=$?
  trap - EXIT
  set +e
  if ((exit_status != 0 && ORCA_SERVICE_STOPPED)); then
    recovery_ok=1
    if ((${#ORCA_INSTALLED_RESTORE_DIRS[@]})); then
      for profile_dir in "${ORCA_INSTALLED_RESTORE_DIRS[@]}"; do
        if sudo test -d "/home/orca/.config/$profile_dir"; then
          if ! sudo mv "/home/orca/.config/$profile_dir" \
            "$ORCA_RESTORE/$profile_dir.failed"; then
            recovery_ok=0
          fi
        fi
      done
    fi
    if ((${#ORCA_MOVED_CURRENT_DIRS[@]})); then
      for profile_dir in "${ORCA_MOVED_CURRENT_DIRS[@]}"; do
        if sudo test -d "$ORCA_POST_UPGRADE/$profile_dir"; then
          if ! sudo mv "$ORCA_POST_UPGRADE/$profile_dir" /home/orca/.config/; then
            recovery_ok=0
          fi
        elif ! sudo test -d "/home/orca/.config/$profile_dir"; then
          recovery_ok=0
        fi
      done
    fi
    if [[ -n "$ORCA_POST_UPGRADE" ]]; then
      sudo rmdir "$ORCA_POST_UPGRADE" 2>/dev/null || true
    fi
    if ((ORCA_CURRENT_BINARY_MOVED)); then
      if sudo test -f "$ORCA_CURRENT_BINARY"; then
        if ! sudo mv -f "$ORCA_CURRENT_BINARY" /opt/orca/orca-linux.AppImage; then
          recovery_ok=0
        fi
      elif ! sudo test -f /opt/orca/orca-linux.AppImage; then
        recovery_ok=0
      fi
    fi
    if ((ORCA_CURRENT_VERSION_MOVED)); then
      if sudo test -f "$ORCA_CURRENT_VERSION"; then
        if ! sudo mv -f "$ORCA_CURRENT_VERSION" /opt/orca/VERSION; then
          recovery_ok=0
        fi
      elif ! sudo test -f /opt/orca/VERSION; then
        recovery_ok=0
      fi
    elif ((ORCA_VERSION_REPLACEMENT_STARTED)); then
      if ! sudo rm -f /opt/orca/VERSION; then
        recovery_ok=0
      fi
    fi
    if ((recovery_ok)); then
      # A tripped StartLimitBurst refuses a plain start
      sudo systemctl reset-failed orca-serve.service || true
      sudo systemctl start orca-serve.service || true
    else
      echo 'Rollback recovery failed; service remains stopped' >&2
    fi
  fi
  if [[ -n "$ORCA_ROLLBACK_BINARY_STAGED" ]]; then
    sudo rm -f -- "$ORCA_ROLLBACK_BINARY_STAGED"
  fi
  if [[ -n "$ORCA_ROLLBACK_VERSION_STAGED" ]]; then
    sudo rm -f -- "$ORCA_ROLLBACK_VERSION_STAGED"
  fi
  sudo rm -rf -- "$ORCA_RESTORE"
  exit "$exit_status"
}
trap restart_after_rollback_error EXIT

if [[ "$(sudo stat -c %d "$ORCA_RESTORE")" != \
  "$(sudo stat -c %d /home/orca/.config)" ]]; then
  echo 'Refusing rollback because staging and the Orca profile are on different filesystems' >&2
  exit 1
fi
sudo tar xzf "$ORCA_ROLLBACK/profile.tgz" -C "$ORCA_RESTORE"
ORCA_RESTORE_DIRS=()
for profile_dir in orca Orca; do
  if sudo test -L "$ORCA_RESTORE/$profile_dir"; then
    echo "Rollback bundle contains a symlinked profile: $profile_dir" >&2
    exit 1
  fi
  if sudo test -d "$ORCA_RESTORE/$profile_dir"; then
    if [[ "$profile_dir" == Orca ]] && \
      sudo test "$ORCA_RESTORE/orca" -ef "$ORCA_RESTORE/Orca"; then
      continue
    fi
    ORCA_RESTORE_DIRS+=("$profile_dir")
  fi
done
if ((${#ORCA_RESTORE_DIRS[@]} == 0)); then
  echo "Rollback bundle has no Orca profile directories: $ORCA_ROLLBACK" >&2
  exit 1
fi
for profile_dir in "${ORCA_RESTORE_DIRS[@]}"; do
  sudo chown -R orca:orca "$ORCA_RESTORE/$profile_dir"
done

ORCA_ROLLBACK_STAMP=$(date +%F-%H%M%S-%N)
ORCA_ROLLBACK_BINARY_STAGED=/opt/orca/orca-linux.AppImage.rollback-staged-$ORCA_ROLLBACK_STAMP
sudo cp -a "$ORCA_ROLLBACK/orca-linux.AppImage" "$ORCA_ROLLBACK_BINARY_STAGED"
if sudo test -f "$ORCA_ROLLBACK/VERSION"; then
  ORCA_ROLLBACK_HAS_VERSION=1
  ORCA_ROLLBACK_VERSION_STAGED=/opt/orca/VERSION.rollback-staged-$ORCA_ROLLBACK_STAMP
  sudo cp -a "$ORCA_ROLLBACK/VERSION" "$ORCA_ROLLBACK_VERSION_STAGED"
fi

ORCA_SERVICE_STOPPED=1
sudo systemctl stop orca-serve.service

# Preserve and replace only Orca-owned profile directories
ORCA_CURRENT_DIRS=()
for profile_dir in orca Orca; do
  if sudo test -L "/home/orca/.config/$profile_dir"; then
    echo "Refusing symlinked Orca profile: /home/orca/.config/$profile_dir" >&2
    exit 1
  fi
  if sudo test -d "/home/orca/.config/$profile_dir"; then
    if [[ "$profile_dir" == Orca ]] && \
      sudo test /home/orca/.config/orca -ef /home/orca/.config/Orca; then
      continue
    fi
    ORCA_CURRENT_DIRS+=("$profile_dir")
  fi
done
ORCA_POST_UPGRADE=/home/orca/.config/orca-rollback-$ORCA_ROLLBACK_STAMP
sudo install -d -o orca -g orca -m 700 "$ORCA_POST_UPGRADE"
if ((${#ORCA_CURRENT_DIRS[@]})); then
  for profile_dir in "${ORCA_CURRENT_DIRS[@]}"; do
    ORCA_MOVED_CURRENT_DIRS+=("$profile_dir")
    sudo mv "/home/orca/.config/$profile_dir" "$ORCA_POST_UPGRADE/"
  done
fi
for profile_dir in "${ORCA_RESTORE_DIRS[@]}"; do
  ORCA_INSTALLED_RESTORE_DIRS+=("$profile_dir")
  sudo mv "$ORCA_RESTORE/$profile_dir" /home/orca/.config/
done

ORCA_CURRENT_BINARY=/opt/orca/orca-linux.AppImage.rollback-current-$ORCA_ROLLBACK_STAMP
ORCA_CURRENT_BINARY_MOVED=1
sudo mv /opt/orca/orca-linux.AppImage "$ORCA_CURRENT_BINARY"
sudo mv -f "$ORCA_ROLLBACK_BINARY_STAGED" /opt/orca/orca-linux.AppImage

ORCA_CURRENT_VERSION=/opt/orca/VERSION.rollback-current-$ORCA_ROLLBACK_STAMP
if sudo test -f /opt/orca/VERSION; then
  ORCA_CURRENT_VERSION_MOVED=1
  sudo mv /opt/orca/VERSION "$ORCA_CURRENT_VERSION"
fi
ORCA_VERSION_REPLACEMENT_STARTED=1
if ((ORCA_ROLLBACK_HAS_VERSION)); then
  sudo mv -f "$ORCA_ROLLBACK_VERSION_STAGED" /opt/orca/VERSION
else
  sudo rm -f /opt/orca/VERSION
fi
# The crash-looping build you are rolling back from tripped StartLimitBurst
sudo systemctl reset-failed orca-serve.service
sudo systemctl start orca-serve.service
ORCA_SERVICE_STOPPED=0
sudo rm -rf -- "$ORCA_RESTORE"
trap - EXIT
```

Restaurar el respaldo es obligatorio, no opcional: cambiar solo el binario deja
intacto el `orca-data.json` más nuevo, donde un build más antiguo puede descartar
estado que no entiende. Conserva el respaldo previo a la actualización hasta que la
nueva versión esté probada en tu host. El directorio `orca-rollback-*` dentro de
`.config` también se conserva a propósito. El binario y el registro de versión
posteriores a la actualización se conservan en `/opt/orca` con el mismo sufijo
`rollback-current-<timestamp>`. Inspecciona estos artefactos y elimínalos según tu
política de retención una vez resuelto el rollback.

## Registrar cuentas de agentes sin escritorio

Un servidor sin cuenta administrada inicia los agentes con el login que tenga el
propio `~/.claude` o `~/.codex` del usuario, que en un host recién instalado es
ninguno: `worktree create`, `terminal create` y `orchestration worker-start` abren
panes cuyo agente no puede iniciar sesión. En el escritorio, esas cuentas se
agregan desde Settings, que lleva a cabo el login OAuth del proveedor a través de
un navegador que Orca puede abrir. Un host sin interfaz gráfica no tiene ninguna
de las dos cosas, así que cada cuenta se registra desde una sesión SSH:

```bash
ssh dev1@your-server          # the Linux user whose `orca serve` should own the account
orca account add              # Claude (default); needs the `claude` CLI on PATH
orca account add --agent codex  # Codex; needs the `codex` CLI on PATH
```

`orca account add` ejecuta el login real del proveedor (`claude auth login
--claudeai`, o `codex login --device-auth`) dentro de esa terminal, en un
directorio de configuración desechable; luego entrega el directorio con la sesión
iniciada al runtime local y lo borra. El runtime ya debe estar corriendo para ese
usuario (en primer plano o con la unidad de systemd de arriba); de lo contrario, el
comando falla antes de iniciar el login, así que nunca inicias sesión en vano.

Ninguno de los dos logins necesita un navegador en el servidor. Claude imprime la
URL de inicio de sesión y espera el código que muestra la página después de que
inicias sesión. Verificado desde un shell sin `DISPLAY` ni `BROWSER` definidos,
esta es toda la primera pantalla:

```
Opening browser to sign in…
If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=...&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&...
Paste code here if prompted >
```

Abre esa URL en cualquier máquina con navegador, inicia sesión con la cuenta que
estás agregando y pega el código de vuelta en la sesión SSH. Codex usa device
authorization por el mismo motivo; ese es el flag `--device-auth` que pasa Orca.
Ctrl-C en el prompt aborta y elimina el directorio temporal; no se registra nada.

Luego confirma que el runtime la registró, con el mismo usuario:

```bash
orca account list
```

Muestra el proveedor, el email, el id y la selección global `active` del runtime de
ese usuario. Una cuenta que no aparece aquí no se registró, diga lo que diga la
página del proveedor. Un runtime demasiado antiguo para aceptar registros desde la
CLI lo rechaza antes de que empiece el login, con `The running Orca runtime is too old to add accounts from
the CLI`: primero actualiza `orca serve` y luego agrega la cuenta.

Lo que no funciona, a propósito:

- **Un escritorio o teléfono emparejado no puede agregar una cuenta al servidor.**
  El RPC de registro lee una ruta de credenciales en el sistema de archivos del
  host, así que solo se acepta por el socket local y rechaza a todo cliente
  emparejado con `Adding Claude accounts is only available on the Orca host runtime.`
  (Codex tiene la misma protección). Un remoto que pudiera indicar rutas del host
  también podría leerlas. La página de Settings en un escritorio emparejado
  administra las cuentas de ese escritorio, no las del servidor.
- **Las cuentas no se cruzan entre usuarios.** Viven bajo el directorio home del
  usuario dueño, así que, con un `orca serve` por desarrollador, cada desarrollador
  registra sus propias cuentas con su propio login y nunca ve las de otro.

Una cuenta por persona, no una cuenta compartida por el equipo. Un refresh token de
Claude es de un solo uso: el segundo runtime que refresca una cuenta compartida
obtiene un token nuevo y la sesión del primero muere en su siguiente refresh, lo
que se ve como un `Login expired` aleatorio en un worker que funcionaba bien hace
un minuto. Dos procesos `orca serve` que comparten un login de Claude se van a
seguir cerrando la sesión el uno al otro.

## Instalar skills de agentes sin escritorio

Las skills de agentes de Orca (uso de la CLI, orquestación, computer use, etc.)
normalmente se instalan desde Orca Settings, que deja precargado en una terminal un
comando `npx skills add ... --global` para que lo ejecutes. Un host sin interfaz
gráfica no tiene la UI de Settings, así que usa `orca skills install` en su lugar:

```bash
orca skills install                                      # list installable skills
orca skills install --skill orca-cli --skill orchestration # install globally (default)
orca skills install --skill orca-cli --local              # install into the current project only
orca skills install --all                                 # install every bundled skill
orca skills install --all --dry-run                       # print the npx commands without running them
```

Esto resuelve el mismo comando `npx skills add <repo> --skill <name> ...` que te
mostraría Settings (agregando `--global` a menos que se pase `--local`), luego lo
ejecuta y reenvía su salida y su código de salida. Requiere `node`/`npx` en el
host; no necesita un runtime de Orca en ejecución.

Cada skill se descarga del repositorio que la distribuye, y `skills add` clona un
repositorio por ejecución. Por eso, una selección que abarca más de uno (`--all`, o
una skill de Orca Lab como `switch-account` pedida junto con una de upstream) se
resuelve en un `skills add` por repositorio. `--dry-run` los imprime todos, una
ejecución real los ejecuta todos uno tras otro, y el código de salida es el primero
distinto de cero.

A diferencia del comando que muestra Settings, el que se lanza agrega `npx --yes` y
`-y`. Sin ellos, la CLI de `skills` abre un selector interactivo de agentes y se
bloquea para siempre en cualquier TTY asignada, lo que incluye una sesión `ssh`
normal. Usa `--dry-run` para ver el comando exacto que se va a ejecutar.

Settings mantiene ese selector a propósito, porque elegir qué agentes reciben una
skill es una decisión real. Una ejecución sin interfaz gráfica no puede
responderla, así que, en lugar de omitir la elección, Orca la hace de forma
explícita: pasa una lista `--agent` construida a partir de los agentes de
programación que detecta en el host, más el directorio compartido `.agents/skills`
que él mismo lee. Si se la deja decidir por su cuenta sin ningún agente detectado,
la CLI de `skills` instala en los ~75 agentes que conoce y deja un directorio de
configuración para cada uno. Indica tú mismo los destinos, o limítalos solo al
directorio compartido:

```bash
orca skills install --skill orca-cli --agent claude-code,codex
orca skills install --skill orca-cli --agent universal
```

Si Orca no detecta ningún agente, `orca skills install` se detiene y pide
`--agent` en lugar de adivinar.

Para refrescar skills ya instaladas, `orca skills update` replica los mismos flags
de selección (`--skill`, `--all`, `--local`, `--dry-run`) y se resuelve en
`npx skills update <names...>` con el flag de alcance correspondiente: `--global`,
o `--project` cuando pasas `--local`:

```bash
orca skills update --all                                  # update every bundled skill globally
orca skills update --skill orca-cli --dry-run             # print the npx command without running it
```

`skills update` no recibe repositorio, así que nunca necesita la división de
arriba: vuelve a descargar cada skill desde la fuente que registró su propio lock
cuando se instaló, y así es como una skill de Orca Lab sigue convergiendo desde el
fork.

`orca skills update` solo refresca skills que ya están instaladas: termina con 0
sin hacer nada para una skill que falta, así que instálala primero. En general, un
código de salida 0 significa que la CLI de `skills` se ejecutó sin errores, no que
haya escrito algo; lee su salida para confirmar qué cambió.

`--json` cubre el listado de skills y `--dry-run`. Una ejecución real transmite tal cual la
salida de la CLI de `skills`, que no es JSON, y rechaza `--json`.

Ambos comandos instalan en la máquina que los ejecuta. En un workspace SSH de Orca
o en el puente de WSL, el shim `orca` reenvía los comandos al host de Orca, así que
se niegan a ejecutarse ahí e imprimen el comando que debes ejecutar en la máquina
que quieras.

## Solución de problemas

- `dlopen(): error loading libfuse.so.2`: instala `libfuse2`.
- `Missing X server or $DISPLAY`: instala `xvfb`, o inicia el servicio de Xvfb
  administrado y define `DISPLAY=:99`.
- `Xvfb not found`: confirma con `command -v Xvfb` y usa esa ruta absoluta en la
  unidad de systemd.
- Advertencias de GPU o DRI en un VPS: mantén `LIBGL_ALWAYS_SOFTWARE=1` en el
  entorno del servicio.
- Errores del sandbox de Chromium: confirma que el servicio corre con el usuario
  `orca` sin privilegios de root y que ese usuario puede leer `/opt/orca`.
- Los clientes no pueden conectarse: asegúrate de que `--pairing-address` sea una
  dirección alcanzable desde el cliente y de que los firewalls permitan el `--port`
  seleccionado.
- El journal muestra `Another Orca instance is already running for this userData
  profile` y la unidad termina con `3`: otro proceso ya es dueño del perfil, así que
  `RestartPreventExitStatus=3` deja la unidad en `failed` a propósito. Encuentra al
  dueño con `systemctl status orca-serve` y `pgrep -af orca`. Detenlo (o consérvalo
  y deja la unidad detenida) y luego ejecuta
  `sudo systemctl reset-failed orca-serve && sudo systemctl start orca-serve`:
  `reset-failed` limpia el estado de falla y cualquier contador del límite de
  arranques. Si no existe ningún dueño, el lock está obsoleto (Chromium registró un
  pid que desde entonces se reutilizó): elimina `SingletonLock` y `SingletonSocket`
  del directorio de userData y vuelve a arrancar. Si un crash-loop anterior ya dejó
  montajes de AppImage colgados, lístalos con `findmnt -rn -t fuse.orca-linux.AppImage`
  y libera solo los que no tienen un dueño vivo con `fusermount -uz <target>` (o
  `umount -l <target>`), sin tocar el montaje de la instancia en ejecución.
- El servicio entra en crash-loop justo después de una actualización: usa
  [Rollback](#rollback) con el paquete `.ready` previo a la actualización. No
  vuelvas a ejecutar la actualización primero; si lo haces, la versión que falla se
  convertiría en el siguiente binario de rollback. El loop dispara
  `StartLimitBurst`, así que cualquier `systemctl start` manual fuera de ese script
  necesita antes `sudo systemctl reset-failed orca-serve.service`.
- Para diagnosticar otras bibliotecas que falten: extrae el AppImage sin lanzarlo
  con `./orca-linux.AppImage --appimage-extract` y luego ejecuta
  `ldd squashfs-root/orca` para listar las bibliotecas compartidas que le faltan al
  host.
