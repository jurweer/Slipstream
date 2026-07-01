# Background-audio spike

**Question this answers:** on your actual phones, does leader audio keep playing — and
does the app keep running its clock — when the screen locks or the tab is backgrounded?
If the answer is "no," the whole PWA plan needs rethinking (→ native), so we prove it
*before* building anything else.

## What it does

- Pick a local audio file, play it (no bundled music — you supply the file).
- Wires up the **MediaSession API** (lock-screen controls + a keep-alive hint).
- Logs `visibilitychange`, page-lifecycle events, and a playback "tick" every 5s so you
  can confirm progress continues while the screen is off.
- Installable as a PWA (manifest + service worker) — installed PWAs get better
  background-audio behaviour than a plain browser tab.

## Run it

Desktop sanity check (mechanics only — backgrounding behaves differently than mobile):

```bash
cd slipstream/spike-audio
python3 -m http.server 8090
# open http://localhost:8090
```

**Real test = on your phone**, and here's the catch: service workers + `MediaSession`
need a **secure context** (HTTPS), and `localhost` doesn't count from a *different*
device. So to load it on your phone you need one of:

- an HTTPS tunnel to the local server (e.g. an `ssh -R` / `cloudflared` / `ngrok`-style
  tunnel you already have), or
- serving it over HTTPS on the LAN with a locally-trusted cert.

Ask me and I'll wire up whichever route matches what's already on your box — I won't
install anything new.

## What to look for

1. Pick a track, hit **Play**, confirm the position ticks.
2. **Lock the screen** (or switch to another app) for ~30s.
3. Unlock and read the log:
   - ✅ **Pass:** `tick @ …` lines kept appearing with `hidden=true`, audio never paused.
   - ⚠️ **Partial:** audio kept playing but ticks froze (JS was throttled — fine for
     playback, but our shared-clock needs a rethink, e.g. drive timing off audio events).
   - ❌ **Fail:** audio paused on lock. That's the PWA background limit — signals native.
4. Try the **lock-screen media controls** (play/pause) — confirm they hit our handlers.

Record results per device (iOS Safari is the strict one; test it first). Those results
decide step 2 of the roadmap.
