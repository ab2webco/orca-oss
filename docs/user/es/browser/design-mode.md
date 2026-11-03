---
sourceHash: 7f5aa14e9ffc4136
---
# Navegador y Design Mode

Orca Lab tiene un navegador integrado. Puedes usarlo para previsualizar una página que tu agente está construyendo
y enviarle al agente comentarios sobre un elemento de la página.

## Abrir el navegador

- `Mod+Shift+B` abre una nueva pestaña del navegador.
- `Mod+L` mueve el foco a la barra de direcciones.
- La barra de direcciones acepta direcciones `http://`, `https://` y `localhost`.

## Capturar un elemento

- Pulsa `Mod+C` (o elige **Grab page element**) y haz clic en un elemento de la página.
- La captura muestra los detalles del elemento. Pulsa `C` para copiarlos, o `S` para hacer una captura de pantalla.
- La captura no hace nada mientras escribes en un campo de texto.

## Anotar y enviar comentarios

- Elige **Annotate page element** en un elemento para dejar una nota.
- Marca cada nota como **Question** o **Change**.
- Haz clic en **Send feedback to an agent** y elige una terminal de agente, o inicia un agente nuevo.
- El mensaje al agente es una sección de Markdown llamada **Design Feedback**. Incluye la URL de la página, el
  tamaño del viewport, el selector CSS del elemento, sus clases, sus estilos calculados y un fragmento de
  HTML.

Las anotaciones solo funcionan en pestañas locales del navegador. No están disponibles cuando el navegador se
ejecuta en un runtime remoto.
