// parley configuration
//
// Edit this file with your OAuth App's Client ID and (optionally) a default
// repo. The Client ID is NOT a secret — it's safe to commit.
//
// To create an OAuth App:
//   github.com → Settings → Developer settings → OAuth Apps → New
//   - Homepage URL: your GitHub Pages URL
//   - Authorization callback URL: same (unused by device flow, but required)
//   - Enable Device Flow: YES (this is the important one)
//
// Required scopes (granted at sign-in time):
//   - repo (or public_repo for public-only)
//   - read:discussion, write:discussion
//   - models:read   (for GitHub Models inference)
//
window.PARLEY_CONFIG = {
  clientId: "Ov23linIWX77Xvv3ytXu",

  // Default repo to load on startup. Leave null to prompt the user.
  defaultRepo: {
    owner: "knutties",
    name: "parley",
  },

  // One-line tagline shown under the brand in the topbar and on the
  // auth/repo-picker cards. Keep it short — it sits next to the wordmark.
  tagline: "github discussions as a group chat",

  // Where the brand wordmark links to. Defaults to the canonical parley
  // repo; forks should point this at their own source.
  sourceUrl: "https://github.com/knutties/parley",

  // GitHub Models inference endpoint (rarely needs changing).
  modelsEndpoint: "https://models.github.ai/inference/chat/completions",

  // Default model. Users can override in the UI.
  defaultModel: "openai/gpt-4o",

  // Fallback model list used if the live catalog fetch fails (offline,
  // 401, rate-limited, etc.). Also used to seed the picker on first paint
  // before the catalog has resolved. Trim/extend to taste.
  models: [
    { id: "openai/gpt-4o", label: "GPT-4o" },
    { id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
    { id: "meta/Llama-3.3-70B-Instruct", label: "Llama 3.3 70B" },
    { id: "mistral-ai/Mistral-Large-2411", label: "Mistral Large" },
    { id: "deepseek/DeepSeek-V3", label: "DeepSeek V3" },
  ],

  // Live-catalog discovery. When true, parley fetches
  // https://models.github.ai/catalog/models on boot and uses the result
  // to populate the picker — so the dropdown stays in sync with whatever
  // GitHub Models currently exposes. The fallback `models` list above is
  // used if the fetch fails.
  useLiveModels: true,

  // Optional case-insensitive substring allowlist applied to the live
  // catalog's model `id` field. Empty array means "include everything
  // that looks like a chat-completion model". Useful to keep the picker
  // short — e.g. ["openai/gpt", "meta/llama", "mistral", "deepseek"].
  modelFilter: [
    "openai/gpt",
    "meta/llama",
    "mistral-ai/mistral",
    "deepseek/deepseek",
  ],

  // The bot's "persona" prompt. Edit to taste.
  botSystemPrompt:
    "You are a collaborator in a GitHub Discussion rendered as a group chat. " +
    "Multiple humans and you participate. Read the thread context carefully. " +
    "Be concise. Use markdown. When code is involved, use fenced code blocks " +
    "with language tags. If you're uncertain, say so. Address people by their " +
    "GitHub login when responding to them specifically.",

  // How often to poll for new comments (ms). 5s is a reasonable chat pace.
  pollIntervalMs: 5000,

  // Trigger phrase that invokes the bot. Anything mentioning this string
  // (case-insensitive) in a posted comment will queue a bot response.
  // Kept in sync with the parley-bot branding and the /parley-bot slash
  // command in the composer.
  botTrigger: "@parley-bot",

  // Local development uses dev-server.js, which exposes this same-origin
  // proxy route. For production, replace corsProxy with your hosted Worker.
  localCorsProxy: "/proxy?url=",

  corsProxy: "https://my-first-worker.knutties.workers.dev/?url=",

};
