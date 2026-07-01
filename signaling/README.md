# Signaling server

Brokers **rides** (rooms) so riders can find each other and exchange the WebRTC handshake
+ shared-clock messages. **Signalling only** — once peers are connected, audio/data flows
peer-to-peer over WebRTC and never touches this server.

Dependency-free: **SSE (server → client) + POST (client → client)** using only Node
built-ins. No `ws`, no `npm install`. (Reuses the studio's SSE pattern.)

## Run

```bash
node signaling/server.mjs 8100      # default port 8100
```

## Protocol

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/events?ride=CODE&peer=ID&name=NAME` | Join a ride — opens an SSE stream |
| `POST` | `/signal` — body `{ ride, from, to?, type, data }` | Relay to one peer (`to`) or broadcast to the rest |
| `GET`  | `/rides/CODE` | Lobby view — `{ code, peers:[{id,name}] }` |
| `GET`  | `/health` | `{ ok, rides, peers }` |

### SSE events a client receives
- `joined` — `{ self, peers:[…] }` (who's already here when you join)
- `peer-joined` — `{ id, name }`
- `peer-left` — `{ id }`
- `signal` — `{ from, type, data }` (relayed handshake / clock message)

### Flow
1. Each rider opens `/events?ride=…&peer=…` → gets the current peer list.
2. To connect to a peer, POST `/signal` with `type: 'webrtc-offer' | 'webrtc-answer' | 'ice'`
   and `to: <peerId>`; the target receives it as a `signal` SSE event.
3. Shared-clock updates (`type: 'clock'`) broadcast to the whole ride (no `to`).

Verified end-to-end: two peers join, discover each other, and a `webrtc-offer` relays
correctly (see commit history).

## Notes / next
- In-memory rooms; peers auto-removed on SSE disconnect (empty rides are dropped).
- CORS is `*` for dev so the PWA (served from another origin) can connect — tighten later.
- **Next:** a browser `room.js` client module in the PWA that wraps join + `RTCPeerConnection`
  handshake, then DataChannel file transfer + shared-clock sync.
