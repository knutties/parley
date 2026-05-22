# discuss/chat

A chat interface for **GitHub Discussions**, with a built-in LLM bot powered by
**GitHub Models**. Pure static site — no backend, no database. Deployable to
GitHub Pages in a few minutes.

## What it is

- Renders any GitHub Discussion thread as a chat conversation.
- Lets you post replies via a chat composer (Cmd/Ctrl+Enter to send).
- Includes a bot you can `@bot` to summon — it reads the thread context and
  posts a reply through GitHub Models.
- Discussions remain the canonical store. Everything you send lands as a real
  GitHub Discussion comment, with a real permalink, searchable, indexed,
  notifying subscribers, etc.

## Architecture

```
[ browser SPA ] ──→ GitHub GraphQL API   (read/write Discussions)
       │
       └────────→ GitHub Models inference (LLM responses)
```

Two API endpoints, one OAuth identity, zero servers of your own.

## Setup

### 1. Create a GitHub OAuth App

Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**.

- **Application name:** anything (`discuss-chat`)
- **Homepage URL:** your GitHub Pages URL (e.g. `https://<user>.github.io/discuss-chat/`)
- **Authorization callback URL:** same as Homepage URL (unused, but required)
- **Enable Device Flow:** ✅ **YES** — this is critical. Without it, sign-in won't work.

Click **Register application**. Copy the **Client ID** (looks like `Iv1.abc123…`).

### 2. Configure

Edit `config.js`:

```js
window.DISCUSS_CHAT_CONFIG = {
  clientId: "Iv1.YOUR_ID_HERE",
  defaultRepo: { owner: "yourname", name: "yourrepo" },
  // ...
};
```

### 3. (Optional) Set up your own CORS proxy

GitHub's device-flow endpoints don't send CORS headers, so the browser can't
hit them directly. The default config uses a public proxy (`cors.lol`) which
is fine for hobby use but **not recommended for anything serious**.

The cleanest self-hosted option is a tiny Cloudflare Worker:

```js
// worker.js
export default {
  async fetch(req) {
    const url = new URL(req.url).searchParams.get("url");
    if (!url || !url.startsWith("https://github.com/login/")) {
      return new Response("forbidden", { status: 403 });
    }
    const r = await fetch(url, { method: req.method, headers: req.headers, body: req.body });
    const out = new Response(r.body, r);
    out.headers.set("Access-Control-Allow-Origin", "*");
    return out;
  },
};
```

Deploy it, then in `config.js`:

```js
corsProxy: "https://your-worker.workers.dev/?url=",
```

### 4. Deploy to GitHub Pages

Two common patterns:

**Option A — root of a repo:** copy `index.html`, `styles.css`, `config.js`,
`app.js`, `github.js`, `auth.js`, `markdown.js` into a repo's root, enable
Pages on the `main` branch.

**Option B — `/docs` folder:** drop the files into `docs/`, enable Pages on
`main → /docs`.

Either way, the URL you set as the OAuth Homepage URL must match where the
site is actually served from.

### 5. Enable Discussions

If your target repo doesn't have Discussions turned on:
**Settings → General → Features → Discussions ✅**

## Using it

1. Visit your deployed site.
2. Click **Sign in with GitHub** — you'll get a code; paste it on github.com.
3. The site loads your repo's discussions in the sidebar.
4. Click any discussion to open it as a chat.
5. Type and Cmd/Ctrl+Enter to send.
6. Mention `@bot` (or whatever trigger you configured) to have the bot reply.
7. Or just click **ask bot** to get a fresh response without posting first.

## How the bot works

- Reads the full thread (discussion body + all comments + nested replies)
- Builds an OpenAI-style messages array with roles assigned by author
  (bot author → `assistant`, everyone else → `user`)
- Calls `https://models.github.ai/inference/chat/completions` with your chosen
  model
- Posts the response as a new comment on the discussion

Inference is billed against the signed-in user's GitHub Models quota.
GitHub's free tier is generous enough for casual use.

## Identifying the bot

By default the app considers any author whose login contains `bot` or ends in
`[bot]` to be the bot, for purposes of building the assistant/user message
roles. If you want a cleaner setup, create a **GitHub machine user** (a
second GitHub account named e.g. `yourrepo-bot`) and sign into the app with
that account when you want to act as the bot. Or just use your own account —
everything still works, the role-mapping will treat your own posts as
`assistant` only when you sign in as the bot account.

## Limits & trade-offs

- **Polling, not streaming.** New comments appear within `pollIntervalMs`
  (default 5s). Not real-time, but plenty for human-pace chat.
- **No typing indicators / presence.** GitHub doesn't expose these for
  Discussions.
- **No edit/delete UI yet.** Round-trip back to github.com if you need to
  edit or delete a comment.
- **OAuth Device Flow requires a CORS proxy.** See step 3.
- **Bot quota is per-user.** Each signed-in user spends their own GitHub
  Models tokens.

## Files

```
index.html      — entry point
styles.css      — single stylesheet
config.js       — user-edited configuration
app.js          — main view orchestration
github.js       — GraphQL + Models API calls
auth.js         — OAuth device flow
markdown.js     — small markdown renderer (for bot output preview)
```

No build step. No node_modules. No bundler. Just files.

## License

MIT, do whatever.
