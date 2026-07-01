# Slipstream

Share your ride's music, walkie-talkie style. One rider (the *leader*) plays their
own music library; everyone else in the group hears it on their own earbuds, in sync,
while riding together.

> Working name — rename freely.

## Core idea

- **Physically-together group ride**, phones only, PWA (no app store needed for MVP).
- **Leader broadcasts their own owned music** — not Spotify's catalog. (Spotify/Apple
  audio is DRM-locked and cannot be peer-streamed; see "What we deliberately don't do".)
- **No mandatory pre-ride sync.** Late joiners start hearing the current track
  immediately; upcoming tracks fill in the background.

## Architecture (decided)

Model: **prefetch files + shared-clock sync + local playback** (NOT live audio streaming).

- Leader distributes the actual audio files to followers, rolling *ahead* of the playhead
  while signal is good. Followers cache upcoming tracks (Cache Storage / IndexedDB).
- "Sync" is a tiny shared-clock message — `{ track, position, playing }` — a few bytes,
  not a stream. Each follower plays its **local cached copy** at that position.
- **Connection drops → playback continues from cache.** On reconnect, snap back to the
  leader's current position. As long as the next tracks are cached, audio never stops.
- Transport: cloud signaling (WebSocket) + WebRTC (files over DataChannel, clock over the
  same peer connection). Audio takes the LAN route automatically when riders share a subnet.
- Cache is **ephemeral**: evict per-track after play, wipe on ride-end.

### Join / discovery

- **Pre-register a ride** before start (installs/caches the PWA, joins the room).
- At the meetup: open the app → auto-join over the internet. (No in-pocket/screen-off
  requirement for MVP.)
- **Hotspot-share mode** (post-MVP): leader shares cell data via hotspot; a **Wi-Fi-join
  QR** (`WIFI:T:WPA;S:..;P:..;;`, native to iOS/Android) gets riders on the LAN with zero
  typing. Audio then flows phone-to-phone over local Wi-Fi.
  - True *zero-internet* hotspot needs a native shim (a PWA can't run a signaling server) —
    parked as a later phase.

## Roadmap

- [ ] **Spike:** prove leader audio survives a backgrounded / locked screen on real phones
      (`spike-audio/`). ← start here; de-risks everything.
- [x] Signaling server + room join — dependency-free SSE+POST relay (`signaling/`); join,
      peer discovery, and WebRTC-offer relay verified end-to-end.
- [ ] Browser `room.js` client: wrap join + `RTCPeerConnection` handshake in the PWA.
- [ ] WebRTC DataChannel file transfer + IndexedDB cache.
- [ ] Shared-clock sync + local player.
- [ ] Reconnect / snap-to-leader logic.
- [ ] Collaborative queue — **riders contribute their own owned files** (the killer feature).
- [ ] **Connect Spotify (headline)** + legal delivery modes (see [`docs/legal-sources.md`](docs/legal-sources.md)):
      add music from your own Spotify library; each rider hears it via **Mode C** (their own
      Premium) · **Mode B** free catalogs (**Jamendo**, **Internet Archive**) · **Mode A** owned
      files. Queue items are references; Spotify-added tracks resolve premium → catalog → skip.
- [ ] **Group telemetry in ride mode (later, parked)** — share live sensor data across the
      group in ride mode: power, cadence, heart rate (with room for other sport modes). Reads
      standard BLE sensors (Heart Rate / Cycling Power / Speed-Cadence) via Web Bluetooth —
      Android-capable, but **iOS Safari has no Web Bluetooth**, so likely needs the native shim
      (same constraint as hotspot BLE). Broadcasts over the existing ride channel alongside the
      audio clock.
- [ ] Hotspot-share mode + Wi-Fi-join QR.
- [ ] Native shim for true offline hotspot.

## What we deliberately don't do

- **No peer-streaming of Spotify/Apple Music audio** — DRM-protected, not legally or
  technically possible. Their "listen together" (Jam / SharePlay) syncs *playback state*,
  not audio, and has no public API to build on.
- **No sourcing commercial tracks from "free" libraries.** Resolving a share link to
  metadata is fine; downloading a free full copy of a copyrighted song is piracy and is
  intentionally not built. The link resolver only matches owned/licensed/CC sources.

## Legal posture — building for the strong case

Slipstream is deliberately engineered to sit in the most defensible zone of private,
among-friends music sharing, and to make that posture *structural* rather than a promise.
(Not legal advice — this is the design rationale.)

**Why files, not fetching.** The app never sources audio from the internet. A rider can only
add files **they already hold**. Under the NL private-copying levy (thuiskopieheffing) and EU
law, copies from a **lawful source** are the protected case; the CJEU's *ACI Adam* ruling (a
Dutch case) explicitly excludes copies from **unlawful sources** — so an auto-fetch-from-
"free"-library feature is exactly the carve-out, and owning a track never legitimises pulling
it from a pirate source. That feature is intentionally absent.

**Ownership gate (honor-based).** Songs can only be added after the rider affirms they own /
have the right to play them. The tool can't verify ownership, so it steers toward the
"everyone brought music they own" pattern — the strongest case, where each participant is a
lawful source and there's no lost sale.

**Ride-scoped ephemerality.** The more transient the copy, the weaker any durable-copy claim.
Slipstream keeps audio **bounded to the ride**: files are held in **ride-scoped storage
(IndexedDB)** so a mid-ride browser reload doesn't drop the queue, are **evicted when removed**,
and are **wiped when the ride ends** (End & wipe). Nothing persists past the ride. This is a
deliberate softening of a stricter "memory-only" posture (chosen for reload resilience) — it's
no longer the pure Art. 5(1) transient-copy case, but combined with the ownership gate it keeps
the owned-file sharing clearly *ride playback*, not a permanent music locker. Ephemerality never
launders an unlawful source — which is why **files-not-fetching** stays the load-bearing rule.

Net: **owned files + honor gate + ride-scoped wipe** = the strongest position;
**app-as-downloader** = out, on purpose.

**Where music may come from** is defined in [`docs/legal-sources.md`](docs/legal-sources.md):
a whitelist of permissive/downloadable/redistributable sources, three delivery modes
(A peer-bytes · B link-and-fetch from licensed catalogs · C per-rider Premium sync), and the
per-source obligations (attribution, non-commercial scope).

## Competitive landscape

The audio-broadcast tech is commodity (silent-disco apps: Lysn in, SoundSeeder; multi-phone
sync: AmpMe; hardware: Cardo/Sena mesh intercoms). **No one targets outdoor group cycling
with software-only, earbud, frictionless pre-register/auto-join + a collaborative queue.**
That combination — the *ride-day UX*, not the streaming — is the defensible part.
