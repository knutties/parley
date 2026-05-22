// discuss/chat configuration
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
window.DISCUSS_CHAT_CONFIG = {
  clientId: "YOUR_OAUTH_CLIENT_ID_HERE",

  // Default repo to load on startup. Leave null to prompt the user.
  defaultRepo: {
    owner: "YOUR_GITHUB_USERNAME",
    name: "YOUR_REPO_NAME",
  },

  // GitHub Models inference endpoint (rarely needs changing).
  modelsEndpoint: "https://models.github.ai/inference/chat/completions",

  // Default model. Users can override in the UI.
  defaultModel: "openai/gpt-4o",

  // Available models in the picker. Trim/extend to taste.
  models: [
    { id: "openai/gpt-4o", label: "GPT-4o" },
    { id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
    { id: "meta/Llama-3.3-70B-Instruct", label: "Llama 3.3 70B" },
    { id: "mistral-ai/Mistral-Large-2411", label: "Mistral Large" },
    { id: "deepseek/DeepSeek-V3", label: "DeepSeek V3" },
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
  // Use "@bot" or whatever feels natural in your community.
  botTrigger: "@bot",
};
