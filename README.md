# parley

A chat interface for **GitHub Discussions**, with a built-in LLM bot powered
by **GitHub Models**. Pure static site — no backend, no database. Deploys to
GitHub Pages.

## What it does

- Renders any GitHub Discussion thread as a chat conversation.
- Lets you post replies via a chat composer (Cmd/Ctrl+Enter to send).
- Supports **threaded replies** to individual comments — click `reply` on
  any top-level comment to open an inline composer that posts as a reply
  in that subthread.
- Includes a bot you summon with `@bot` — it reads the thread context and
  posts a reply through GitHub Models. The bot reply is prefixed with a
  visible "Bot reply" header because, until a dedicated bot identity is
  wired up, replies are posted via the signed-in user's OAuth token.
- Discussions remain the canonical store. Every message is a real GitHub
  comment with a real permalink, searchable, indexed, and notifying
  subscribers like any other Discussion activity.

## Architecture

```
[ browser SPA ] ──→ GitHub GraphQL API   (read/write Discussions)
       │
       ├────────→ GitHub Models inference (LLM responses)
       │
       └────────→ Cloudflare Worker      (CORS proxy for OAuth device flow)
```

Three endpoints, one OAuth identity, no servers of your own except a tiny
stateless Worker.

## Setup

### 1. Create a **classic OAuth App** (not a GitHub App)

This is the most common pitfall. The app **must** be a classic OAuth App.
GitHub Apps use a different auth model that doesn't support browser-only
Device Flow.

Go to **github.com → Settings → Developer settings → OAuth Apps → New OAuth App**.

- **Application name:** anything (`parley`)
- **Homepage URL:** your GitHub Pages URL (e.g. `https://<user>.github.io/<repo>/`)
- **Authorization callback URL:** same as Homepage URL (unused by device flow,
  but required by the form)

Click **Register application**. Then on the app's settings page, scroll to
the bottom and:

- ☑ **Enable Device Flow** — required, easy to miss
- Click **Update application** to persist the change

Copy the **Client ID** (looks like `Iv1.…` or `Ov23li…`).

### 2. Configure `config.js`

```js
window.DISCUSS_CHAT_CONFIG = {
  clientId: "Iv1.YOUR_ID_HERE",
  defaultRepo: { owner: "yourname", name: "yourrepo" },
  // ... see file for the rest
};
```

### 3. Deploy a CORS proxy (Cloudflare Worker)

GitHub's device-flow endpoints don't send CORS headers, so a pure-static
page can't call them directly. You need a tiny relay. Cloudflare Workers'
free tier is more than enough.

The Worker below has six layers of defense so it can't be repurposed by
others as a free proxy. **Edit the four constants at the top before
deploying** — without them set correctly the Worker will reject your own
requests.

```js
// worker.js — Parley CORS proxy
const ALLOWED_ORIGINS = [
  "https://YOUR-USERNAME.github.io",      // your GitHub Pages origin
  // "https://parley.example.com",         // add a custom domain here later
];

const ALLOWED_TARGETS = [
  "https://github.com/login/device/code",
  "https://github.com/login/oauth/access_token",
];

const ALLOWED_CLIENT_IDS = [
  "Iv1.YOUR_OAUTH_CLIENT_ID",             // from config.js
];

const MAX_BODY_BYTES = 2048;

export default {
  async fetch(req) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }
    if (req.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    const origin = req.headers.get("Origin") || "";
    if (!ALLOWED_ORIGINS.includes(origin)) {
      return new Response("forbidden origin", { status: 403 });
    }

    const target = new URL(req.url).searchParams.get("url");
    if (!ALLOWED_TARGETS.includes(target)) {
      return new Response("forbidden target", { status: 403 });
    }

    const body = await req.text();
    if (body.length > MAX_BODY_BYTES) {
      return new Response("body too large", { status: 413 });
    }

    try {
      const parsed = JSON.parse(body);
      if (!ALLOWED_CLIENT_IDS.includes(parsed.client_id)) {
        return new Response("forbidden client", { status: 403 });
      }
    } catch {
      return new Response("invalid body", { status: 400 });
    }

    const ghResp = await fetch(target, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "parley-auth-proxy",
      },
      body,
    });

    return new Response(await ghResp.text(), {
      status: ghResp.status,
      headers: { "Content-Type": "application/json", ...corsHeaders(req) },
    });
  },
};

function corsHeaders(req) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : "null",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
  };
}
```

Then in `config.js`:

```js
corsProxy: "https://your-worker.workers.dev/?url=",
```

> **If you fork Parley**, you must deploy your own Worker with your own
> Client ID in `ALLOWED_CLIENT_IDS`. The original Worker will refuse your
> requests by design — that's the abuse protection working as intended.
> See the "Hardening" section below for the threat model and what each
> layer defends against.

### 4. Enable Discussions on the target repo

If the repo doesn't have Discussions on:
**Settings → General → Features → Discussions ✅**

### 5. Deploy to GitHub Pages

The static site lives in `src/`. Two ways to publish it:

- **From `src/` via GitHub Actions** (recommended for this layout):
  set Pages source to **GitHub Actions** and use a workflow that uploads
  the `src/` directory as the Pages artifact. The
  `actions/upload-pages-artifact` action takes a `path: ./src` input.
- **From a `gh-pages` branch**: build (or copy) `src/*` to the root of a
  `gh-pages` branch and point Pages there.

If you prefer to skip Actions entirely, you can rename `src/` to `docs/`
and point Pages at `main → /docs` — GitHub Pages serves `/docs` directly
from any branch.

Whichever route you pick, the URL Pages serves the site at must match the
OAuth App's Homepage URL.

## Using it

1. Visit your deployed site
2. Click **Sign in with GitHub** → copy the code, paste it at github.com/login/device
3. Authorize the app (consent screen will list "Full control of repositories")
4. Discussions load in the sidebar
5. Click any discussion to open it as chat
6. Cmd/Ctrl+Enter to send
7. Mention `@bot` in a message, or click **ask bot**, to get an LLM reply

## How the bot works

- Reads the full thread (discussion body + comments + nested replies)
- Builds an OpenAI-style messages array, assigning roles by author
  (bot author → `assistant`, everyone else → `user`). Past parley bot
  replies are also recognised via an embedded HTML-comment marker even
  when they were posted under a human's GitHub identity.
- Calls `https://models.github.ai/inference/chat/completions` with the
  selected model
- Posts the response as a new comment on the discussion, prefixed with a
  visible **Bot reply** header so it's distinguishable from a human reply
  even though the comment appears under the signed-in user's name and
  avatar.

Inference is billed against the signed-in user's GitHub Models quota. The
free tier covers casual use comfortably.

## OAuth scopes

The app requests just one scope: **`repo`**.

- Why only `repo`? Because it's a classic OAuth scope that already includes
  discussion read/write as a side effect, and it's the only scope a classic
  OAuth App needs for the writes this app performs.
- Why not `models:read`? It's a fine-grained PAT scope, not a classic
  OAuth scope. GitHub rejects classic OAuth device-flow requests that ask
  for it. Models access for OAuth tokens is gated at the account level, not
  by scope.

## Hardening the Worker against abuse

The Worker's URL is public (it lives in `config.js`). Without the defenses
in the Worker above, anyone who finds the URL could use it as a free relay
to GitHub's OAuth endpoints — burning your Cloudflare quota, or even
authenticating against their own OAuth Apps through your infrastructure.

The Worker uses six defensive layers, listed by what each one stops:

| Defense | Stops |
|---|---|
| **Origin allowlist** (`Access-Control-Allow-Origin` + server-side check) | Any other website embedding requests to your Worker. The browser sets `Origin` automatically and JavaScript can't override it. |
| **Method allowlist** (POST + OPTIONS only) | GET-based probing, scanning, accidental requests. |
| **URL allowlist** (exact match, not prefix) | Anyone trying to use the Worker to hit other GitHub endpoints. |
| **Body size cap** (2 KB) | Memory abuse via oversized payloads. Real device-flow bodies are ~100 bytes. |
| **Client ID allowlist** | The big one. Even a non-browser client that spoofs the Origin header can only authenticate against *your* OAuth App. They can't bring their own Client ID. |
| **Strict header forwarding** | The Worker rewrites headers rather than passing them through, so request smuggling tricks via header injection don't reach GitHub. |

**What it doesn't defend against:**

- A determined attacker with your Client ID is still authenticating against
  your OAuth App on behalf of *themselves*. Their token belongs to them and
  grants access to their data, not yours. There's no escalation path through
  the Worker — it's only useful for relaying OAuth, not for accessing
  anyone's data.
- Volumetric DOS. If someone genuinely wants to flood your Worker, the
  Tier-1 defenses don't slow them down (they short-circuit early, but
  Cloudflare still counts each request). Add IP-based rate limiting in the
  Cloudflare dashboard if you see abuse — the free tier includes basic
  rate-limit rules.

**Optional rate limiting** (recommended once you're past the prototype
phase):

1. In the Cloudflare dashboard: **Workers & Pages → your Worker →
   Settings → Bindings → Add → Rate Limiter**
2. Configure `simple = { limit = 10, period = 60 }` to allow ~10 req/min
   per IP — enough for honest polling, low enough to crush abuse
3. In the Worker, check `await env.RATE_LIMITER.limit({ key: ip })` early
   and return 429 on failure

For typical use the Tier-1 defenses above are sufficient. Add the rate
limiter when the project gets enough traffic to need it.

## Identifying the bot

By default the app treats any author whose login contains `bot` or ends in
`[bot]` as the bot, for purposes of role-mapping in the LLM prompt. For a
cleaner setup, create a dedicated GitHub machine user (`<repo>-bot`) and use
it when acting as the bot. Personal accounts work too — your own messages
will simply all be `user` role in the prompt.

## Limits & trade-offs

- **Polling, not streaming.** New comments appear within `pollIntervalMs`
  (default 5s). Not real-time, but fine for human-pace chat.
- **No typing indicators or presence.** GitHub doesn't expose these for
  Discussions.
- **No edit/delete UI.** Round-trip to github.com to edit or delete a
  comment.
- **Bot quota is per-user.** Each signed-in user spends their own GitHub
  Models tokens.
- **Broad `repo` scope.** Classic OAuth doesn't have a discussions-only
  scope. If this matters for your context, use a dedicated machine user
  with access only to the relevant repos.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Device code request failed: 400` + `invalid_scope` | Scope string requests something a classic OAuth App doesn't recognize. Use `"repo"` only. |
| `Device code request failed` + CORS error | Worker isn't deployed, or isn't handling OPTIONS preflight. |
| Sign-in succeeds but `Resource not accessible by integration` on post | App is a **GitHub App**, not an OAuth App. Recreate as OAuth App. |
| Sign-in succeeds, `x-oauth-scopes` is empty | Device Flow checkbox wasn't saved on the OAuth App. |
| Posting works, bot call returns 401/403 | The signed-in account doesn't have GitHub Models enabled. Enable it under github.com/settings/copilot or the Models marketplace. |

## Files

```
src/
  index.html      — entry point
  styles.css      — single stylesheet
  config.js       — user-edited configuration
  app.js          — view orchestration + state
  github.js       — GraphQL + Models API calls
  auth.js         — OAuth device flow
  markdown.js     — minimal markdown renderer
```

No build step. No `node_modules`. No bundler. Static files only — Pages
just serves the contents of `src/`.

## License

MIT.
