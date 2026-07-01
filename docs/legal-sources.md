# Slipstream — Legal Sources & Delivery Model

Source of truth for **where Slipstream is allowed to get music** and **how it reaches each
rider**. If a source isn't on the whitelist here with a delivery mode, it doesn't get built.
(Not legal advice — this is the project's design/compliance posture.)

Companion to the README "Legal posture" section.

---

## 1. What makes a source "pullable"

Because Slipstream may **cache and redistribute** audio, a source qualifies only if it meets
**all three**:

1. **Permissive license** — Creative Commons, public domain, or an explicit royalty-free
   grant. Not merely "free to stream."
2. **Downloadable audio** — an API/direct URL that yields the actual file. Stream-only is
   useless to the prefetch model.
3. **Redistribution permitted** — so re-sending to the group is lawful. CC/PD allow this;
   DRM commercial catalogs never do.

The one thing that is **never** built: resolving a track's identity and then sourcing a free
full copy of a **commercial** recording from any "free"/pirate library. Owning a license does
not make a pirate download lawful (CJEU *ACI Adam*).

---

## 2. Delivery modes

How a track actually reaches each rider depends on its provenance:

### Mode A — Local-copy sharing (peer bytes)
For **owned files with no public URL** (a rider's own library). The leader sends the actual
bytes over a WebRTC DataChannel; followers cache + play.
- ✅ Only mode that works **offline / on a leader hotspot** (no internet).
- Redistribution basis: owned-among-owners / CC. See README legal posture.

### Mode B — Link-and-fetch (share a reference)
For **catalog tracks that have a public download URL** (Jamendo, Internet Archive). The leader
broadcasts only `{source, trackId, downloadUrl}` + the shared clock; **each rider fetches the
file directly from the source** and caches it.
- ✅ Legally cleanest — *nothing is redistributed*; each rider pulls their own copy from the
  licensed source.
- ✅ Leader uploads nothing (source CDN does the work).
- ⚠️ Each rider needs connectivity to the source at fetch time (no offline/hotspot).

### Mode C — Premium metadata sync (per-rider, no file moves)
For **commercial links** (Spotify/Apple) when a rider has that subscription. The leader shares
a track reference; **each rider with Premium plays it on their own account**, synced to the
shared clock. **No audio bytes ever move.** This is the only lawful way to include the
commercial catalog.
- ⚠️ Requires each rider to have the subscription + be online. Riders without it → track is
  skipped/silent for them (or falls back to a Mode B legal alternate if one exists).

---

## 3. The reference-resolution model

A queue item is a **reference** carrying ordered delivery strategies. Each rider resolves it
via the **best option they're entitled to**:

```
TrackRef {
  id                       // stable within the ride
  title, artist            // display + matching
  isrc?                    // canonical match key when known (via MusicBrainz)
  addedBy
  strategies: [            // ordered; each rider picks the first it can satisfy
    { mode: 'own' },                                    // I already hold this file  → play local
    { mode: 'catalog', source, downloadUrl,            // fetch from licensed source (Mode B)
      license, licenseUrl, attribution },
    { mode: 'premium', provider: 'spotify', uri }       // play on my own account   (Mode C)
  ]
}
```

Per-rider resolution order: **own → catalog (B) → premium (C) → skip.**

---

## 4. Source whitelist (verified July 2026)

### First build (confirmed scope)

| Source | Mode | License | Pull mechanism | Status |
|---|---|---|---|---|
| Rider's own / group owned files | **A** | owner-supplied | local file → WebRTC bytes | ✅ built |
| **Jamendo** | **B** | CC (BY / BY-SA / BY-NC …), per-track | API v3.0 `/tracks` → `audiodownload` + `license_ccurl`; `client_id` required | ✅ build 1st |
| **Internet Archive** | **B** | CC + public domain | `archive.org/metadata/{id}`, advancedsearch; direct `download/{id}/{file}` | ✅ build |
| **Spotify** (connect) | **C** | commercial (own account) | OAuth connect; metadata sync; **Premium** to play | ✅ build |
| **MusicBrainz** | resolver | CC0 data (no audio) | `/ws/2` search by artist+title / ISRC → MBID | ✅ glue for C |

### Later candidates (verify API status first)

| Source | Mode | Notes |
|---|---|---|
| ccMixter | B | CC remixes/samples; query API + file URLs — verify |
| Musopen | B | Classical, public domain; API key — verify |
| Wikimedia Commons | B | Freely-licensed audio; MediaWiki API — niche |

### Rejected (and why)

- **Free Music Archive** — API **shut down**; no hotlinking, no scraping. CC music usable only
  as *manual* downloads a rider adds as owned files (Mode A), not an integrated pull source.
- **Pixabay Music** — public API is images/video only; no music endpoint.
- **YouTube Audio Library** — no public API (creator tool only).
- **Any Spotify/Apple *audio*** — DRM. Metadata + 30s previews only; Mode C is the sole path.

---

## 5. Per-source integration notes

### Jamendo (Mode B)
- API: `https://api.jamendo.com/v3.0/tracks/` with `client_id`, `format=json`,
  `include=musicinfo+licenses`. Track objects expose `audiodownload` (file URL) and
  `license_ccurl`.
- **Terms:** API is **free for non-commercial use only**; commercial use → contact Jamendo
  licensing. **BY-NC** tracks cannot be used commercially.
- **Obligation:** display artist credit + link to the track's CC license.

### Internet Archive (Mode B)
- Discovery: `advancedsearch.php?q=collection:(etree OR netlabels)&fl=identifier,title,...`.
- Files: `https://archive.org/metadata/{identifier}` → file list; download at
  `https://archive.org/download/{identifier}/{file}`. Prefer VBR/derived MP3 for size.
- Collections: `etree` (Live Music Archive — taper-approved), `netlabels` (CC), `78rpm` /
  `oldtimeradio` (public domain). Respect per-item rights metadata.

### Spotify (Mode C — "connect")
- **Auth:** OAuth 2.0 **Authorization Code + PKCE** (public client, fits a PWA — no secret).
- **Scopes:** `streaming`, `user-read-playback-state`, `user-modify-playback-state`,
  `user-read-currently-playing`.
- **Playback:** Web Playback SDK (creates an in-browser device) **or** Web API
  `PUT /me/player/play` with `uris` + `position_ms`. **Both require Spotify Premium.**
- **Link → identity:** resolve a shared `open.spotify.com` link via oEmbed / Web API
  `/tracks/{id}` to `{title, artist, isrc}`; use ISRC with MusicBrainz to also look for a
  Mode-B legal alternate for non-Premium riders.
- **Never** touches audio bytes — pure state sync. No public API for Spotify Jam; we implement
  our own sync over the shared clock.

### MusicBrainz (resolver, no audio)
- `https://musicbrainz.org/ws/2/recording?query=...&fmt=json`; match by artist+title or ISRC.
- Rate-limited (~1 req/s) + requires a descriptive `User-Agent`. CC0 data.

---

## 6. Obligations baked into the app

1. **Attribution UI** — every CC track (Mode B) shows *artist · title · source · license link*
   on the now-playing card. Required by CC-BY / BY-SA and Jamendo's conditions.
2. **Non-commercial scope** — Jamendo's API terms + BY-**NC** tracks require the use to stay
   non-commercial. A private group ride qualifies. **If Slipstream is ever monetized**, both
   Jamendo's API terms and all NC tracks must be revisited.
3. **Offline reality** — only **Mode A** works with no internet (hotspot ride). Modes B/C need
   each rider online at fetch/play time; the UI should make that clear.
4. **Registry enforces the whitelist** — a source adapter cannot register unless it returns a
   permissive `license` + a `downloadUrl` (Mode B) or a valid per-rider play path (Mode C).
   The code *is* the whitelist.

---

## 7. Open items

- [ ] Verify ccMixter + Musopen API status before adding.
- [ ] Decide MP3 bitrate/target per source to bound cache size.
- [ ] Spotify app registration (client ID, redirect URIs) — needed before Mode C works.
- [ ] Attribution display component spec.
