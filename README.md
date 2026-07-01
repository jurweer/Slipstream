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
- [ ] Signaling server + room join (pre-register a ride).
- [ ] WebRTC DataChannel file transfer + IndexedDB cache.
- [ ] Shared-clock sync + local player.
- [ ] Reconnect / snap-to-leader logic.
- [ ] Collaborative queue — **riders contribute their own owned files** (the killer feature).
- [ ] Legal link resolver (post-MVP): paste Spotify/Apple link → metadata → match against
      (files already in the group | licensed free catalogs: FMA/Jamendo/ccMixter/YT Audio
      Library | optional per-track Premium metadata-sync for riders who have it).
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

**Rigorous ephemerality.** Distribution is only a durable-copy problem if the data persists.
Slipstream leans on the EU Art. 5(1) transient-copy exception (the one that makes streaming
legal): audio lives in **memory only** (in-memory Blobs / object URLs), is **never written to
persistent storage**, is **evicted after play**, and is **wiped at ride-end / on app close**.
Ephemerality doesn't launder an unlawful source — but combined with the ownership gate it
makes the owned-file sharing clearly *synchronised playback*, not a music locker.

Net: **owned files + honor gate + memory-only + wipe-on-end** = the strongest position;
**app-as-downloader** = out, on purpose.

## Competitive landscape

The audio-broadcast tech is commodity (silent-disco apps: Lysn in, SoundSeeder; multi-phone
sync: AmpMe; hardware: Cardo/Sena mesh intercoms). **No one targets outdoor group cycling
with software-only, earbud, frictionless pre-register/auto-join + a collaborative queue.**
That combination — the *ride-day UX*, not the streaming — is the defensible part.
