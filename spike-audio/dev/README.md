# Dev HTTPS server (on-phone testing)

Serves `spike-audio/` over TLS so `MediaSession` and the service worker get a secure
context. Zero dependencies — just Node + a self-signed cert. **Cert/key are gitignored.**

## Run

```bash
cd slipstream/spike-audio
node dev/server.mjs 8443          # prints the https://<LAN-IP>:8443 URL
```

Current LAN URL: **https://10.5.9.124:8443** (phone must be on the same Wi-Fi).

## Regenerate the cert (e.g. LAN IP changed)

```bash
cd slipstream/spike-audio/dev
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 \
  -subj "/CN=slipstream-spike" \
  -addext "subjectAltName=IP:<YOUR_LAN_IP>,IP:127.0.0.1,DNS:localhost"
```

## Two levels of trust

**Level 1 — quick browser test (just accept the warning).** Open the network URL on the
phone, tap through the "not private / not trusted" warning. Audio + MediaSession work.
The **service worker will NOT register** (browsers require a *trusted* cert for that), so
`Installed (PWA): no` — fine for a first background-audio read.

**Level 2 — installed-PWA test (install the cert as trusted).** Needed to register the SW
and "Add to Home Screen", which is the config most likely to survive iOS backgrounding.

- **iOS:** AirDrop/email `cert.pem` to the phone → install the profile
  (Settings → Profile Downloaded) → then **Settings → General → About → Certificate Trust
  Settings** and toggle **full trust** on. Reload → SW registers → Share → Add to Home
  Screen → launch from the icon.
- **Android:** Settings → Security → Encryption & credentials → Install a certificate →
  CA certificate → pick `cert.pem`. Reload → SW registers → menu → Install app.

## Stop the server

```bash
pkill -f "dev/server.mjs"
```
