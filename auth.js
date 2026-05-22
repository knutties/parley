// auth.js — GitHub OAuth Device Flow (no backend needed)
//
// Note: GitHub's device flow endpoints don't send CORS headers, so we route
// through a CORS proxy for the browser. We use the cors.lol public proxy by
// default — for production you should host your own (e.g. a Cloudflare
// Worker that just forwards to github.com/login/device/*).
//
// Alternative: many users self-host this app via "github.io" anyway, and a
// 20-line Cloudflare Worker as the CORS proxy is the cleanest setup.

const DEFAULT_PROXY = "https://cors.lol/?url=";
const SCOPES = "repo";

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

function proxied(url) {
  const proxy = window.PARLEY_CONFIG.corsProxy || DEFAULT_PROXY;
  return proxy + encodeURIComponent(url);
}

export async function startDeviceFlow(clientId) {
  const r = await fetch(proxied(DEVICE_CODE_URL), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, scope: SCOPES }),
  });
  if (!r.ok) throw new Error(`Device code request failed: ${r.status}`);
  return await r.json();
  // { device_code, user_code, verification_uri, expires_in, interval }
}

export async function pollForToken(clientId, deviceCode, interval, onTick) {
  const wait = (s) => new Promise((res) => setTimeout(res, s * 1000));
  let curInterval = interval;
  // GitHub spec says cap at expires_in (typically 900s).
  for (let i = 0; i < 200; i++) {
    await wait(curInterval);
    if (onTick) onTick(i);
    const r = await fetch(proxied(ACCESS_TOKEN_URL), {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    const json = await r.json();
    if (json.access_token) return json.access_token;
    if (json.error === "authorization_pending") continue;
    if (json.error === "slow_down") { curInterval += 5; continue; }
    if (json.error === "expired_token") throw new Error("Code expired. Please try again.");
    if (json.error === "access_denied") throw new Error("Authorization denied.");
    if (json.error) throw new Error(json.error_description || json.error);
  }
  throw new Error("Timed out waiting for authorization.");
}

const TOKEN_KEY = "parley_gh_token";

export function saveToken(t) { localStorage.setItem(TOKEN_KEY, t); }
export function loadToken() { return localStorage.getItem(TOKEN_KEY); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }
