# Browser and Design Mode

Orca Lab has an embedded browser. You can use it to preview a page your agent is building, and
send feedback about a page element back to the agent.

## Open the browser

- `Mod+Shift+B` opens a new browser tab.
- `Mod+L` moves focus to the address bar.
- The address bar accepts `http://`, `https://` and `localhost` addresses.

## Grab an element

- Press `Mod+C` (or choose **Grab page element**) and click an element on the page.
- The grab shows the element's details. Press `C` to copy them, or `S` to take a screenshot.
- Grab does nothing while you type in a text field.

## Annotate and send feedback

- Choose **Annotate page element** on an element to leave a note.
- Mark each note as a **Question** or a **Change**.
- Click **Send feedback to an agent** and pick an agent terminal, or start a new agent.
- The message to the agent is a Markdown section named **Design Feedback**. It includes the page
  URL, the viewport size, the element's CSS selector, classes, computed styles and an HTML
  snippet.

Annotations work in local browser tabs only. They are not available when the browser runs in a
remote runtime.
