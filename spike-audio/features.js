// Slipstream — feature flags (CLIENT).
// Flags are controlled SERVER-SIDE. The client only FETCHES the current flag state at boot
// and applies it — there is no in-app toggling. Source of truth lives in the flags service
// (see flags/). Built-in DEFAULTS are a fallback only, used if the server is unreachable
// (so the app still works offline).
//
// Endpoint: `window.SLIP_FLAGS_URL` if set, else same-origin `./flags` (the dev/prod server
// serves the flags config there — same origin avoids CORS + mixed-content on the HTTPS app).

const DEFAULTS = {
  ride_persistence: true,
  diagnostics: true,
  rooms: false,
  catalog_jamendo: false,
  catalog_internet_archive: false,
  spotify_connect: false,
  group_telemetry: false,
  hotspot_mode: false,
};

// Display metadata (read-only) — labels/stage for anything that wants to show flag state.
const REGISTRY = [
  { key: 'ride_persistence', label: 'Ride persistence', stage: 'stable' },
  { key: 'diagnostics', label: 'Spike diagnostics', stage: 'stable' },
  { key: 'rooms', label: 'Group ride (rooms)', stage: 'beta' },
  { key: 'catalog_jamendo', label: 'Jamendo catalog', stage: 'planned' },
  { key: 'catalog_internet_archive', label: 'Internet Archive', stage: 'planned' },
  { key: 'spotify_connect', label: 'Connect Spotify', stage: 'planned' },
  { key: 'group_telemetry', label: 'Group telemetry', stage: 'planned' },
  { key: 'hotspot_mode', label: 'Hotspot mode', stage: 'planned' },
];

const FLAGS_URL = window.SLIP_FLAGS_URL || './flags';

let flags = { ...DEFAULTS };
let source = 'defaults';

async function load() {
  try {
    const res = await fetch(FLAGS_URL, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      flags = { ...DEFAULTS, ...(data.flags || {}) };
      source = `server (${data.updatedAt || 'no timestamp'})`;
    } else {
      source = `defaults (server ${res.status})`;
    }
  } catch {
    source = 'defaults (server unreachable)';
  }
  return flags;
}

function isEnabled(key) { return !!flags[key]; }
function current() { return { ...flags }; }

// `ready` resolves once the server flags are fetched — gate boot on it.
window.SlipFeatures = {
  isEnabled,
  current,
  source: () => source,
  registry: REGISTRY,
  load,
  ready: load(),
};
