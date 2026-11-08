# Rev2D Mobile (GitHub Pages)

The existing Rev2D React/WebGL2 editor remains unchanged in normal server mode.
The Pages build enables an opt-in, browser-only IndexedDB workspace.

## Deployment

Repository Settings → Pages → Build and deployment → Source: **GitHub Actions**.
The workflow `rev2d-pages.yml` builds on `main`. Expected address:
https://theosmanyildirim.github.io/Rev2D/

## Browser-mode features

- Rig viewport, layer hierarchy, Inspector, Parameters, Diagnostics and Timeline.
- Create/Open/Save/Save As to IndexedDB, remembered locally on this device.
- Import native Rev2D JSON with its PNG textures and download the native JSON.
- Included templates, animation playback, PNG viewport export, display settings and Undo/Redo.

## Features requiring a server

- Avatar auto-layer building, AI jobs and drawing variants
- Spine and Live2D conversions, CLI/MCP, server-based file operations

The static build returns explicit errors for unsupported server-only actions, rather than pretending they ran.

## Data safety

No browser workspace data is sent to GitHub. IndexedDB is per browser and is not a GitHub backup.
Download your `.r2d.json` and keep its imported PNG textures somewhere safe before clearing site data.
For all Rev2D features, host/run the Node editor server (`rev2d edit`) with proper access control.

## Verification

CI compilation and Pages deployment are separate from real mobile browser and device verification.
