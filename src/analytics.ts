/**
 * Google Analytics (GA4). Loaded only in production builds — a local dev server would
 * otherwise report every reload as real traffic. Property: "Rayo Bandido" under
 * juanchaher99@gmail.com, stream `rayobandido.com`.
 *
 * `track` is the one way anything in the game reports an event. In dev it only logs to the
 * console (`console.debug`, hidden unless Verbose is on), so the calls can be checked without
 * polluting the property. `?ga_debug=1` on a production page sends with `debug_mode`, which is
 * what GA's DebugView listens for.
 *
 * WHAT IS NEVER SENT: emails, nicknames, room labels or anything a player typed. The account's
 * internal id goes up as `user_id`, which is what GA allows.
 *
 * Every screen is a page load (`src/main.ts`), so `page_view` fires on its own for each one;
 * `initAnalytics` names the screen so the reports can tell the menu from a race — the path is
 * the same for all of them, only the query string differs.
 *
 * Gameplay events are mapped in `src/analyticsPlay.ts`. Anything raised many times a second
 * (drifts, near misses, props) is counted there and reported once, in `play_summary`.
 */
const MEASUREMENT_ID = 'G-DTWZ769LQ7';

declare global {
  interface Window {
    dataLayer: unknown[];
  }
}

export type AnalyticsValue = string | number | boolean | undefined;
export type AnalyticsParams = Record<string, AnalyticsValue>;

const enabled = !import.meta.env.DEV;
let initialized = false;

// gtag.js reads `arguments` objects off the data layer; a plain array is ignored.
function gtag(..._args: unknown[]): void {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(arguments);
}

/** GA4 caps a parameter value at 100 characters; longer ones are dropped whole, so trim them. */
function clean(params: AnalyticsParams): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value === undefined) continue;
    if (typeof value === 'number') out[key] = Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
    else if (typeof value === 'string') out[key] = value.slice(0, 100);
    else out[key] = value;
  }
  return out;
}

/** Which screen this address shows: the same routing `src/main.ts` does, as a name. */
export function screenFromUrl(search: string = location.search): string {
  const params = new URLSearchParams(search);
  if (params.has('mp')) return params.has('room') || params.has('create') ? 'mp_room' : 'mp_rooms';
  const mode = params.get('mode');
  if (mode) return mode === 'metro' ? 'world_city' : `world_${mode}`;
  if (params.has('race') || params.get('quick') === '1') return 'menu_quick';
  if (params.has('quick')) return 'menu_quick_mode';
  if (params.has('log')) return 'changelog';
  if (params.has('lore')) return 'lore';
  return 'menu_main';
}

export function initAnalytics(): void {
  if (initialized) return;
  initialized = true;
  const screen = screenFromUrl();
  if (!enabled) {
    console.debug('[analytics] page_view', screen);
    installErrorTracking();
    return;
  }
  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID, {
    page_title: screen,
    screen_name: screen,
    ...(new URLSearchParams(location.search).has('ga_debug') ? { debug_mode: true } : {}),
  });
  setUserProperties({ touch_device: 'ontouchstart' in window || navigator.maxTouchPoints > 0 });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);
  installErrorTracking();
}

/**
 * Report one event. Safe to call from anywhere and at any time — before `initAnalytics`, in
 * dev, in a test with no `window` — and it never throws into the game.
 */
export function track(name: string, params: AnalyticsParams = {}): void {
  try {
    if (typeof window === 'undefined') return;
    const payload = clean(params);
    if (!enabled) {
      console.debug('[analytics]', name, payload);
      return;
    }
    gtag('event', name, payload);
  } catch {
    /* analytics must never break the game */
  }
}

/** User-scoped dimensions (register them in GA → Admin → Custom definitions → User scope). */
export function setUserProperties(props: AnalyticsParams): void {
  try {
    if (typeof window === 'undefined') return;
    const payload = clean(props);
    if (!enabled) {
      console.debug('[analytics] user_properties', payload);
      return;
    }
    gtag('set', 'user_properties', payload);
  } catch {
    /* ignore */
  }
}

/** The account's internal id, so one player is one user across devices once they sign in. */
export function setAnalyticsUserId(id: string | null): void {
  try {
    if (!enabled || typeof window === 'undefined') return;
    gtag('config', MEASUREMENT_ID, { user_id: id ?? undefined, send_page_view: false });
  } catch {
    /* ignore */
  }
}

/* ---------------------------------------------------------------- loading */

let loadingMode: string | null = null;
let loadingSince = 0;

/** A world started building. Paired with `loadComplete` / `loadFailed`; a page left in between is `load_abandoned`. */
export function loadStart(mode: string, params: AnalyticsParams = {}): void {
  // The open world starts its clock at the connection, before the build asks again.
  if (loadingMode === mode) return;
  loadingMode = mode;
  loadingSince = performance.now();
  track('load_start', { mode, ...params });
}

export function loadComplete(params: AnalyticsParams = {}): void {
  if (loadingMode === null) return;
  track('load_complete', { mode: loadingMode, load_ms: Math.round(performance.now() - loadingSince), ...params });
  loadingMode = null;
}

export function loadFailed(stage: string, err: unknown): void {
  track('load_failed', {
    mode: loadingMode ?? 'unknown',
    stage,
    error: err instanceof Error ? err.message : String(err),
    ms_elapsed: Math.round(performance.now() - loadingSince),
  });
  loadingMode = null;
}

/* ---------------------------------------------------------------- errors and exits */

let errorsSent = 0;
const MAX_ERRORS = 5;

function installErrorTracking(): void {
  window.addEventListener('error', (e) => {
    if (errorsSent >= MAX_ERRORS) return;
    errorsSent++;
    track('js_error', { message: e.message, error_source: `${(e.filename || '').split('/').pop()}:${e.lineno}`, screen: screenFromUrl() });
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (errorsSent >= MAX_ERRORS) return;
    errorsSent++;
    const reason = e.reason instanceof Error ? e.reason.message : String(e.reason);
    track('js_error', { message: reason, error_source: 'promise', screen: screenFromUrl() });
  });
  window.addEventListener('pagehide', () => {
    if (loadingMode === null) return;
    track('load_abandoned', { mode: loadingMode, ms_elapsed: Math.round(performance.now() - loadingSince) });
    loadingMode = null;
  });
}
