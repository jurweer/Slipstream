# Feature flags (server-side control)

Features are gated **server-side** — the operator flips them here; clients only **fetch and
apply**. There is no in-app toggling. This lets features ship dark and be turned on/off
(or killed) without releasing new client code.

## Pieces

- **`flags.json`** — the source of truth. Edit it to change defaults.
- **`server.mjs`** — the control plane: serves the flags and accepts admin updates.
- Client (`spike-audio/features.js`) fetches the flag state at boot (`window.SlipFeatures`)
  and gates the UI/logic. Built-in defaults are a fallback if the server is unreachable.

## Run

```bash
SLIP_FLAGS_TOKEN=your-secret node flags/server.mjs 8110
```

- `GET  /flags`  → `{ flags: {…}, updatedAt }` (public; clients read this)
- `POST /flags`  → merge changes (admin, `Authorization: Bearer $SLIP_FLAGS_TOKEN`)
- `GET  /health` → `{ ok }`

Flip a flag at runtime:

```bash
curl -X POST localhost:8110/flags \
  -H "Authorization: Bearer $SLIP_FLAGS_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"flags":{"spotify_connect":true,"rooms":true}}'
```

…or just edit `flags.json` and restart. Clients pick up changes on next load.

## How the client reaches the flags

The client fetches `window.SLIP_FLAGS_URL` if set, else same-origin **`./flags`**. The dev
HTTPS server (`spike-audio/dev/server.mjs`) serves `/flags` from this `flags.json`, so the
HTTPS app reads flags **same-origin** — no CORS, no mixed-content. In production, point
`SLIP_FLAGS_URL` at the flags service or proxy `/flags` to it.

## Flags

| Key | Stage | Default | Gates |
|---|---|---|---|
| `ride_persistence` | stable | on | IndexedDB persistence (off = memory-only) |
| `diagnostics` | stable | on | Spike diagnostics panel |
| `rooms` | beta | off | Group ride / signaling client |
| `catalog_jamendo` | planned | off | Jamendo source (Mode B) |
| `catalog_internet_archive` | planned | off | Internet Archive source (Mode B) |
| `spotify_connect` | planned | off | Connect Spotify (Mode C, headline) |
| `group_telemetry` | planned | off | Power/cadence/HR sharing |
| `hotspot_mode` | planned | off | LAN hotspot transfer + Wi-Fi QR |

A `planned`/`beta` flag turning on reveals its (not-yet-built) entry point in the app —
proof the gate works before the feature exists.
