// Slipstream — player (strong-case build, with ride-scoped persistence).
// Guarantees:
//   1. Ownership gate — songs only added after the rider affirms they own them.
//   2. Ride-scoped ephemerality — audio persists across RELOAD (IndexedDB) so a browser
//      refresh mid-ride doesn't lose the queue, but is still evicted on remove and WIPED
//      on "End & wipe" / ride-end. Persistence is bounded to the ride, not forever.
// Also a background-audio spike (visibility + MediaSession + lifecycle logging).
// Functional style: `state` is a passive container, behaviour lives in module fns.

const els = {
  themeToggle: document.getElementById('theme-toggle'),
  rideDot: document.getElementById('ride-dot'),
  rideLabel: document.getElementById('ride-label'),
  rideBtn: document.getElementById('ride-btn'),
  endBtn: document.getElementById('end-btn'),
  ownCheck: document.getElementById('own-check'),
  addBtn: document.getElementById('add-btn'),
  addHint: document.getElementById('add-hint'),
  file: document.getElementById('file'),
  prev: document.getElementById('prev'),
  play: document.getElementById('play'),
  pause: document.getElementById('pause'),
  next: document.getElementById('next'),
  clear: document.getElementById('clear'),
  audio: document.getElementById('audio'),
  queue: document.getElementById('queue'),
  empty: document.getElementById('empty'),
  npTitle: document.getElementById('np-title'),
  npSub: document.getElementById('np-sub'),
  log: document.getElementById('log'),
  sState: document.getElementById('s-state'),
  sPos: document.getElementById('s-pos'),
  sVis: document.getElementById('s-vis'),
  sMs: document.getElementById('s-ms'),
  sPwa: document.getElementById('s-pwa'),
};

// queue item: { id, name, size, url (blob URL), owned }
const state = {
  rideActive: false,
  queue: [],
  current: -1,
  nextId: 1,
  lastLoggedSecond: -1,
  lastSavedSecond: -1,
  pendingPos: 0, // restored playhead to apply once, on next loadedmetadata
};

function pad(n) { return String(n).padStart(2, '0'); }
function fmt(sec) { sec = Math.floor(sec || 0); return `${Math.floor(sec / 60)}:${pad(sec % 60)}`; }
function log(msg) {
  const t = new Date().toISOString().slice(11, 23);
  els.log.textContent += `${t}  ${msg}\n`;
  els.log.scrollTop = els.log.scrollHeight;
}
function pill(el, text, cls) { el.textContent = text; el.className = `pill ${cls}`; }

// --- IndexedDB (ride-scoped persistent store) --------------------------------
// Stores: `tracks` (audio blobs + metadata), `meta` (ride flag + playhead).

const DB_NAME = 'slipstream';
let dbPromise = null;

function idb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return idb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
    t.onerror = () => reject(t.error);
  }));
}

const dbPutTrack = (rec) => tx('tracks', 'readwrite', (s) => s.put(rec));
const dbDeleteTrack = (id) => tx('tracks', 'readwrite', (s) => s.delete(id));
const dbAllTracks = () => tx('tracks', 'readonly', (s) => s.getAll());
const dbClearTracks = () => tx('tracks', 'readwrite', (s) => s.clear());
const dbSetMeta = (k, v) => tx('meta', 'readwrite', (s) => s.put({ k, ...v }));
const dbGetMeta = (k) => tx('meta', 'readonly', (s) => s.get(k));
const dbClearMeta = () => tx('meta', 'readwrite', (s) => s.clear());

function savePlayhead() {
  dbSetMeta('playhead', { current: state.current, pos: els.audio.currentTime || 0 }).catch(() => {});
}
// Track order lives in its own meta record so reordering never rewrites (and risks
// clobbering) the stored audio blobs.
function saveOrder() {
  dbSetMeta('order', { ids: state.queue.map((i) => i.id) }).catch(() => {});
}

// --- Ride lifecycle + ephemerality -------------------------------------------

function applyRideActiveUI() {
  state.rideActive = true;
  els.rideDot.classList.add('on');
  els.rideLabel.textContent = 'RIDE LIVE';
  els.rideBtn.disabled = true;
  els.endBtn.disabled = false;
  refreshAddability();
}

function startRide() {
  applyRideActiveUI();
  dbSetMeta('ride', { active: true }).catch(() => {});
  log('ride started');
}

// Wipe = revoke blob URLs, drop references, AND clear persistent storage.
async function wipe(reason) {
  els.audio.pause();
  els.audio.removeAttribute('src');
  els.audio.load();
  const n = state.queue.length;
  for (const item of state.queue) URL.revokeObjectURL(item.url);
  state.queue = [];
  state.current = -1;
  await Promise.all([dbClearTracks(), dbClearMeta()]).catch(() => {});
  renderQueue();
  renderNowPlaying();
  updateControls();
  log(`wiped ${n} track(s) + cleared storage — ${reason}`);
}

async function endRide() {
  await wipe('ride ended');
  state.rideActive = false;
  els.rideDot.classList.remove('on');
  els.rideLabel.textContent = 'NO RIDE';
  els.rideBtn.disabled = false;
  els.endBtn.disabled = true;
  refreshAddability();
}

// --- Ownership gate ----------------------------------------------------------

function refreshAddability() {
  const ready = state.rideActive && els.ownCheck.checked;
  els.addBtn.disabled = !ready;
  els.addHint.textContent = !state.rideActive
    ? 'Start a ride and confirm ownership to add songs.'
    : !els.ownCheck.checked
      ? 'Confirm you own the files (checkbox above) to add songs.'
      : 'Adding files you own — persists across reload, wiped at ride-end.';
}

// --- Queue model -------------------------------------------------------------

async function addFiles(files) {
  if (!(state.rideActive && els.ownCheck.checked)) return;
  const added = Array.from(files).filter((f) => f && f.type.startsWith('audio/'));
  for (const f of added) {
    const id = state.nextId++;
    // Persist the blob first, then reference it in-memory via an object URL.
    await dbPutTrack({ id, name: f.name, size: f.size, owned: true, blob: f }).catch((e) => log(`store failed: ${e}`));
    state.queue.push({ id, name: f.name, size: f.size, url: URL.createObjectURL(f), owned: true });
  }
  if (added.length) { saveOrder(); log(`added ${added.length} owned song(s) — queue now ${state.queue.length}`); }
  renderQueue();
  if (state.current === -1 && state.queue.length) loadIndex(0, false);
  updateControls();
}

async function removeAt(index) {
  const item = state.queue[index];
  if (!item) return;
  URL.revokeObjectURL(item.url);
  await dbDeleteTrack(item.id).catch(() => {});
  state.queue.splice(index, 1);
  log(`removed & evicted "${item.name}"`);
  if (index === state.current) {
    state.current = -1;
    els.audio.removeAttribute('src');
    if (state.queue.length) loadIndex(Math.min(index, state.queue.length - 1), false);
    else renderNowPlaying();
  } else if (index < state.current) {
    state.current -= 1;
  }
  saveOrder(); // blobs untouched — only the order record changes
  renderQueue();
  updateControls();
  savePlayhead();
}

function loadIndex(index, autoplay) {
  const item = state.queue[index];
  if (!item) return;
  state.current = index;
  els.audio.src = item.url;
  state.lastLoggedSecond = -1;
  setMediaMetadata(item.name);
  renderNowPlaying();
  renderQueue();
  updateControls();
  savePlayhead();
  log(`cued [${index + 1}/${state.queue.length}] "${item.name}"`);
  if (autoplay) els.audio.play().catch((e) => log(`play() rejected: ${e.message}`));
}

function playNext() {
  if (state.current + 1 < state.queue.length) loadIndex(state.current + 1, true);
  else log('end of queue');
}
function playPrev() {
  if (els.audio.currentTime > 3 || state.current <= 0) els.audio.currentTime = 0;
  else loadIndex(state.current - 1, true);
}

// --- Rendering ---------------------------------------------------------------

function renderQueue() {
  els.queue.innerHTML = '';
  state.queue.forEach((item, i) => {
    const li = document.createElement('li');
    if (i === state.current) li.className = 'current';
    const idx = document.createElement('span');
    idx.className = 'idx'; idx.textContent = i === state.current ? '♪' : String(i + 1);
    const name = document.createElement('span');
    name.className = 'name'; name.textContent = item.name;
    name.addEventListener('click', () => loadIndex(i, true));
    const owned = document.createElement('span');
    owned.className = 'own-tag'; owned.textContent = 'owned';
    const del = document.createElement('button');
    del.textContent = '✕'; del.setAttribute('aria-label', 'Remove');
    del.addEventListener('click', () => removeAt(i));
    li.append(idx, name, owned, del);
    els.queue.appendChild(li);
  });
  els.empty.style.display = state.queue.length ? 'none' : 'block';
}

function renderNowPlaying() {
  const item = state.queue[state.current];
  if (!item) { els.npTitle.textContent = 'Nothing playing'; els.npSub.textContent = 'add songs to start a queue'; return; }
  els.npTitle.textContent = item.name;
  els.npSub.textContent = `${state.current + 1} of ${state.queue.length} · ${(item.size / 1e6).toFixed(1)} MB · saved`;
}

function updateControls() {
  const has = state.queue.length > 0;
  els.play.disabled = !has;
  els.pause.disabled = !has;
  els.prev.disabled = !has;
  els.next.disabled = state.current + 1 >= state.queue.length;
}

// --- MediaSession ------------------------------------------------------------

function setMediaMetadata(title) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({ title, artist: 'Slipstream leader', album: 'Group ride' });
}
function initMediaSession() {
  if (!('mediaSession' in navigator)) { pill(els.sMs, 'unsupported', 'warn'); log('MediaSession not supported'); return; }
  pill(els.sMs, 'ready', 'ok');
  const set = (a, fn) => { try { navigator.mediaSession.setActionHandler(a, fn); } catch { /* unsupported */ } };
  set('play', () => { log('MediaSession → play'); els.audio.play(); });
  set('pause', () => { log('MediaSession → pause'); els.audio.pause(); });
  set('nexttrack', () => { log('MediaSession → nexttrack'); playNext(); });
  set('previoustrack', () => { log('MediaSession → previoustrack'); playPrev(); });
}
function syncPlaybackState(playing) {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

// --- Audio wiring ------------------------------------------------------------

function wireAudio() {
  const a = els.audio;
  a.addEventListener('play', () => { els.sState.textContent = 'playing'; syncPlaybackState(true); log('audio: play'); });
  a.addEventListener('pause', () => { els.sState.textContent = 'paused'; syncPlaybackState(false); log('audio: pause'); savePlayhead(); });
  a.addEventListener('ended', () => { log('audio: ended → auto-advance'); playNext(); });
  a.addEventListener('stalled', () => log('audio: stalled'));
  a.addEventListener('waiting', () => log('audio: waiting (buffering)'));
  a.addEventListener('error', () => { if (a.getAttribute('src')) log(`audio: error ${a.error && a.error.code}`); });
  a.addEventListener('loadedmetadata', () => {
    if (state.pendingPos > 0 && state.pendingPos < a.duration) { a.currentTime = state.pendingPos; log(`resumed at ${fmt(a.currentTime)}`); }
    state.pendingPos = 0;
  });
  a.addEventListener('timeupdate', () => {
    els.sPos.textContent = fmt(a.currentTime);
    const s = Math.floor(a.currentTime);
    if (s !== state.lastLoggedSecond && s % 5 === 0) {
      state.lastLoggedSecond = s;
      log(`tick @ ${fmt(a.currentTime)}  (hidden=${document.hidden})`);
    }
    if (s !== state.lastSavedSecond && s % 3 === 0) { state.lastSavedSecond = s; savePlayhead(); }
  });
}

// --- Lifecycle / visibility --------------------------------------------------

function wireLifecycle() {
  document.addEventListener('visibilitychange', () => {
    const hidden = document.hidden;
    pill(els.sVis, hidden ? 'hidden' : 'visible', hidden ? 'warn' : 'ok');
    log(`visibilitychange → ${hidden ? 'HIDDEN (backgrounded/locked)' : 'visible'} · audio.paused=${els.audio.paused}`);
    if (hidden) savePlayhead();
  });
  window.addEventListener('pagehide', () => { savePlayhead(); log('pagehide'); });
  window.addEventListener('pageshow', () => log('pageshow'));
}

// --- PWA ---------------------------------------------------------------------

function detectInstalled() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  pill(els.sPwa, standalone ? 'yes' : 'no (in browser)', standalone ? 'ok' : 'warn');
}
function registerSW() {
  if (!('serviceWorker' in navigator)) { log('serviceWorker unsupported'); return; }
  navigator.serviceWorker.register('sw.js')
    .then(() => log('service worker registered'))
    .catch((e) => log(`service worker not registered: ${e.message} (needs trusted HTTPS)`));
}

// --- Theme -------------------------------------------------------------------

function wireTheme() {
  const root = document.documentElement;
  els.themeToggle.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('slip-theme', next); } catch { /* ignore */ }
  });
}

// --- Restore on load (the persistence feature) -------------------------------

async function restore() {
  let ride;
  try { ride = await dbGetMeta('ride'); } catch { return; }
  if (!ride || !ride.active) return;
  applyRideActiveUI();
  els.ownCheck.checked = true; // ownership was already affirmed this ride
  refreshAddability();
  let tracks = [];
  try { tracks = (await dbAllTracks()) || []; } catch { /* ignore */ }
  if (!tracks.length) { log('restored ride (empty queue)'); return; }
  const orderMeta = await dbGetMeta('order').catch(() => null);
  const ids = orderMeta && Array.isArray(orderMeta.ids) ? orderMeta.ids : tracks.map((t) => t.id);
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  for (const t of ordered) {
    state.queue.push({ id: t.id, name: t.name, size: t.size, url: URL.createObjectURL(t.blob), owned: !!t.owned });
  }
  state.nextId = Math.max(...tracks.map((t) => t.id)) + 1;
  const ph = await dbGetMeta('playhead').catch(() => null);
  const idx = ph && Number.isInteger(ph.current) && ph.current >= 0 ? Math.min(ph.current, state.queue.length - 1) : 0;
  state.pendingPos = ph && ph.pos ? ph.pos : 0;
  renderQueue();
  loadIndex(idx, false); // cue, paused — autoplay needs a user gesture
  updateControls();
  log(`restored ride: ${state.queue.length} track(s) from storage (reload-safe)`);
}

// --- Boot --------------------------------------------------------------------

els.rideBtn.addEventListener('click', startRide);
els.endBtn.addEventListener('click', endRide);
els.ownCheck.addEventListener('change', refreshAddability);
els.addBtn.addEventListener('click', () => els.file.click());
els.file.addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
els.play.addEventListener('click', () => {
  if (state.current === -1 && state.queue.length) loadIndex(0, true);
  else els.audio.play().catch((e) => log(`play() rejected: ${e.message}`));
});
els.pause.addEventListener('click', () => els.audio.pause());
els.next.addEventListener('click', playNext);
els.prev.addEventListener('click', playPrev);
els.clear.addEventListener('click', () => { els.log.textContent = ''; });

wireTheme();
initMediaSession();
wireAudio();
wireLifecycle();
detectInstalled();
registerSW();
renderQueue();
updateControls();
refreshAddability();
restore().catch((e) => log(`restore failed: ${e}`));
log('player ready — start a ride, confirm ownership, add songs (queue survives reload)');
