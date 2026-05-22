// app.js — main view + state for discuss/chat

import * as gh from "./github.js";
import * as auth from "./auth.js";
import { renderMarkdown } from "./markdown.js";

const cfg = window.DISCUSS_CHAT_CONFIG;
const $app = document.getElementById("app");

const state = {
  token: null,
  viewer: null,
  repo: null,           // { owner, name }
  repoId: null,
  threads: [],
  activeNumber: null,
  activeDiscussion: null,
  pollTimer: null,
  selectedModel: cfg.defaultModel,
  postingBot: false,
  seenCommentIds: new Set(),
};

// ---------- Utility ----------
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") {
      e.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v !== null && v !== undefined && v !== false) {
      e.setAttribute(k, v);
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return e;
}

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

function isBotAuthor(login) {
  if (!login) return false;
  return login.toLowerCase().endsWith("[bot]") ||
    login.toLowerCase().includes("bot") && state.viewer?.login === login;
  // Simple heuristic — anything with "bot" in the name; users can adjust.
}

// ---------- Top-level render ----------
function render() {
  $app.innerHTML = "";
  if (!state.token) return renderAuth();
  if (!state.repo) return renderRepoPicker();
  return renderMain();
}

// ---------- Auth view ----------
function renderAuth() {
  if (cfg.clientId === "YOUR_OAUTH_CLIENT_ID_HERE" || !cfg.clientId) {
    $app.appendChild(
      el("div", { class: "center-stage" },
        el("div", { class: "card" },
          el("h1", {}, "discuss", el("span", { class: "slash" }, "/"), "chat"),
          el("p", { class: "lede" }, "Configuration needed."),
          el("div", { class: "banner error" },
            "Edit config.js and set clientId to your GitHub OAuth App's Client ID. " +
            "See the comment at the top of that file for setup instructions."
          )
        )
      )
    );
    return;
  }

  const card = el("div", { class: "card" },
    el("h1", {}, "discuss", el("span", { class: "slash" }, "/"), "chat"),
    el("p", { class: "lede" },
      "A chat interface over GitHub Discussions. Sign in with GitHub to begin."
    ),
    el("button", {
      class: "primary",
      onclick: () => beginDeviceFlow(card),
    }, "Sign in with GitHub")
  );
  $app.appendChild(el("div", { class: "center-stage" }, card));
}

async function beginDeviceFlow(card) {
  try {
    card.innerHTML = "";
    card.appendChild(el("h1", {}, "Authorizing…"));
    card.appendChild(el("p", { class: "lede" }, "Requesting a device code…"));

    const flow = await auth.startDeviceFlow(cfg.clientId);

    card.innerHTML = "";
    card.appendChild(el("h1", {}, "One-time code"));
    card.appendChild(el("p", { class: "lede" },
      "Copy this code, then click the button below to open GitHub and paste it in."
    ));
    card.appendChild(el("div", { class: "code-display" }, flow.user_code));
    card.appendChild(el("a", {
      href: flow.verification_uri,
      target: "_blank",
      rel: "noopener",
    },
      el("button", { class: "primary" }, "Open GitHub authorization page →")
    ));
    card.appendChild(el("div", { class: "banner" },
      el("span", { class: "spinner" }), " Waiting for you to authorize…"
    ));

    const token = await auth.pollForToken(cfg.clientId, flow.device_code, flow.interval);
    auth.saveToken(token);
    state.token = token;
    state.viewer = await gh.getViewer(token);
    render();
    bootRepo();
  } catch (e) {
    card.innerHTML = "";
    card.appendChild(el("h1", {}, "Sign-in failed"));
    card.appendChild(el("div", { class: "banner error" }, String(e.message || e)));
    card.appendChild(el("button", {
      class: "primary",
      onclick: () => renderAuth(),
    }, "Try again"));
  }
}

// ---------- Repo picker ----------
function renderRepoPicker() {
  const ownerInput = el("input", { type: "text", placeholder: "octocat", id: "in-owner" });
  const nameInput = el("input", { type: "text", placeholder: "Hello-World", id: "in-name" });

  if (cfg.defaultRepo && cfg.defaultRepo.owner !== "YOUR_GITHUB_USERNAME") {
    ownerInput.value = cfg.defaultRepo.owner;
    nameInput.value = cfg.defaultRepo.name;
  }

  $app.appendChild(
    el("div", { class: "center-stage" },
      el("div", { class: "card" },
        el("h1", {}, "Pick a repo"),
        el("p", { class: "lede" },
          "Which repository's Discussions should we open?"
        ),
        el("label", {}, "owner"),
        ownerInput,
        el("label", {}, "repo"),
        nameInput,
        el("button", {
          class: "primary",
          onclick: () => {
            const o = ownerInput.value.trim();
            const n = nameInput.value.trim();
            if (!o || !n) return;
            state.repo = { owner: o, name: n };
            localStorage.setItem("discuss_chat_repo", JSON.stringify(state.repo));
            bootRepo();
          },
        }, "Open"),
        el("button", {
          class: "ghost",
          onclick: () => { auth.clearToken(); state.token = null; render(); },
        }, "Sign out")
      )
    )
  );
}

// ---------- Main view ----------
function renderMain() {
  const sidebar = el("aside", { class: "thread-list" },
    el("div", { class: "thread-list-header" },
      el("span", {}, "discussions"),
      el("button", { onclick: refreshThreads }, "↻ refresh")
    ),
    ...state.threads.map(renderThreadItem)
  );

  const chatPanel = state.activeDiscussion
    ? renderChatPanel()
    : el("section", { class: "chat" },
        el("div", { class: "empty" },
          el("div", {},
            el("div", { class: "big" }, "Pick a discussion"),
            el("div", {}, "Threads from " + state.repo.owner + "/" + state.repo.name + " appear on the left.")
          )
        )
      );

  $app.appendChild(
    el("header", { class: "topbar" },
      el("div", { class: "brand" },
        "discuss", el("span", { class: "slash" }, "/"), "chat",
        el("span", { class: "tag" }, "GitHub Models")
      ),
      el("div", { class: "repo-crumbs" },
        el("a", {
          href: `https://github.com/${state.repo.owner}`,
          target: "_blank",
        }, state.repo.owner),
        el("span", { class: "sep" }, "/"),
        el("a", {
          href: `https://github.com/${state.repo.owner}/${state.repo.name}/discussions`,
          target: "_blank",
        }, state.repo.name),
        el("span", { class: "sep" }, "·"),
        el("a", {
          href: "#",
          onclick: (e) => {
            e.preventDefault();
            localStorage.removeItem("discuss_chat_repo");
            state.repo = null; state.activeDiscussion = null; state.threads = [];
            render();
          },
        }, "change")
      ),
      el("div", { class: "user-chip" },
        state.viewer?.avatarUrl && el("img", { src: state.viewer.avatarUrl }),
        state.viewer?.login,
        el("button", {
          onclick: () => { auth.clearToken(); state.token = null; render(); },
        }, "sign out")
      )
    )
  );
  $app.appendChild(el("main", { class: "layout" }, sidebar, chatPanel));
}

function renderThreadItem(t) {
  const active = state.activeNumber === t.number;
  return el("div", {
    class: "thread-item" + (active ? " active" : ""),
    onclick: () => loadDiscussion(t.number),
  },
    el("div", { class: "ti-num" }, `#${t.number}`),
    el("div", { class: "ti-title" }, t.title),
    el("div", { class: "ti-meta" },
      el("span", {}, t.author?.login || "anon"),
      el("span", {}, `${t.comments.totalCount} msg`),
      el("span", {}, timeAgo(t.updatedAt))
    )
  );
}

function renderChatPanel() {
  const d = state.activeDiscussion;

  // Flatten comments + replies into chat order
  const flat = [];
  // Discussion body is the first message (from the OP)
  flat.push({
    id: "body:" + d.id,
    author: d.author,
    bodyHTML: d.bodyHTML,
    body: d.body,
    createdAt: d.createdAt,
    isBody: true,
  });
  for (const c of d.comments.nodes) {
    flat.push({ id: c.id, author: c.author, bodyHTML: c.bodyHTML, body: c.body, createdAt: c.createdAt });
    for (const r of c.replies.nodes) {
      flat.push({ id: r.id, author: r.author, bodyHTML: r.bodyHTML, body: r.body, createdAt: r.createdAt, reply: true });
    }
  }

  const messagesEl = el("div", { class: "messages" },
    ...flat.map(renderMessage)
  );

  // Scroll to bottom after render
  setTimeout(() => { messagesEl.scrollTop = messagesEl.scrollHeight; }, 0);

  const textarea = el("textarea", {
    placeholder: `Reply to #${d.number}…  (use ${cfg.botTrigger} to summon the bot)`,
    onkeydown: (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend(textarea);
      }
    },
  });

  const modelSelect = el("select", {
    onchange: (e) => { state.selectedModel = e.target.value; },
  }, ...cfg.models.map((m) =>
    el("option", { value: m.id, selected: m.id === state.selectedModel ? "selected" : null }, m.label)
  ));

  return el("section", { class: "chat" },
    el("div", { class: "chat-header" },
      el("div", { class: "title" }, d.title),
      el("div", { class: "sub" },
        el("span", {}, `#${d.number}`),
        d.category && el("span", {}, `${d.category.emoji || ""} ${d.category.name}`),
        el("span", {}, `opened by ${d.author?.login || "anon"}`),
        el("span", {}, timeAgo(d.createdAt) + " ago"),
        el("a", { href: d.url, target: "_blank" }, "view on github →")
      )
    ),
    messagesEl,
    el("div", { class: "composer" },
      el("div", { class: "composer-inner" },
        textarea,
        el("div", { class: "composer-row" },
          el("div", { class: "hint" },
            el("kbd", {}, navigator.platform.includes("Mac") ? "⌘" : "Ctrl"),
            " + ", el("kbd", {}, "↵"), " to send"
          ),
          el("div", { class: "composer-actions" },
            modelSelect,
            el("button", {
              class: "bot",
              disabled: state.postingBot ? "disabled" : null,
              onclick: () => invokeBot(textarea),
            }, state.postingBot ? "…" : "ask bot"),
            el("button", {
              class: "send",
              onclick: () => handleSend(textarea),
            }, "send")
          )
        )
      )
    )
  );
}

function renderMessage(m) {
  const isBot = isBotAuthor(m.author?.login);
  const isMe = m.author?.login === state.viewer?.login;
  const cls = "msg" + (isBot ? " bot" : "") + (isMe ? " me" : "") + (m.reply ? " reply" : "");

  // Use GitHub's pre-rendered bodyHTML when available (handles emoji, mentions,
  // referenced issues, etc. properly). Otherwise fall back to local markdown.
  const html = m.bodyHTML || renderMarkdown(m.body);

  return el("div", { class: cls },
    el("div", { class: "avatar" },
      m.author?.avatarUrl
        ? el("img", { src: m.author.avatarUrl })
        : null
    ),
    el("div", {},
      el("div", { class: "head" },
        el("span", { class: "author" }, m.author?.login || "ghost"),
        isBot && el("span", { class: "badge" }, "bot"),
        m.isBody && el("span", { class: "badge" }, "op"),
        el("span", { class: "stamp" }, new Date(m.createdAt).toLocaleString())
      ),
      el("div", { class: "body", html })
    )
  );
}

// ---------- Boot/data ----------
async function bootRepo() {
  try {
    await refreshThreads();
  } catch (e) {
    alert("Failed to load discussions: " + e.message);
  }
}

async function refreshThreads() {
  try {
    const { repoId, discussions } = await gh.listDiscussions(
      state.token, state.repo.owner, state.repo.name, 30
    );
    state.repoId = repoId;
    state.threads = discussions;
    render();
  } catch (e) {
    console.error(e);
    if (String(e.message).includes("Bad credentials")) {
      auth.clearToken();
      state.token = null;
      render();
      return;
    }
    throw e;
  }
}

async function loadDiscussion(number) {
  stopPolling();
  state.activeNumber = number;
  state.activeDiscussion = null;
  state.seenCommentIds = new Set();
  render();
  try {
    const d = await gh.getDiscussion(state.token, state.repo.owner, state.repo.name, number);
    state.activeDiscussion = d;
    cacheSeen(d);
    render();
    startPolling();
  } catch (e) {
    alert("Failed to load discussion: " + e.message);
  }
}

function cacheSeen(d) {
  state.seenCommentIds.clear();
  for (const c of d.comments.nodes) {
    state.seenCommentIds.add(c.id);
    for (const r of c.replies.nodes) state.seenCommentIds.add(r.id);
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(async () => {
    if (!state.activeNumber) return;
    try {
      const d = await gh.getDiscussion(state.token, state.repo.owner, state.repo.name, state.activeNumber);
      const before = state.seenCommentIds.size;
      cacheSeen(d);
      const grew = state.seenCommentIds.size > before;
      state.activeDiscussion = d;
      if (grew) render();
    } catch (e) {
      // swallow transient errors; will retry next tick
      console.warn("poll error", e);
    }
  }, cfg.pollIntervalMs);
}

function stopPolling() {
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
}

// ---------- Sending ----------
async function handleSend(textarea) {
  const body = textarea.value.trim();
  if (!body || !state.activeDiscussion) return;
  textarea.value = "";
  try {
    await gh.addComment(state.token, state.activeDiscussion.id, body);
    // Trigger if the user mentioned the bot in their message.
    const triggered = body.toLowerCase().includes(cfg.botTrigger.toLowerCase());
    await refreshDiscussion();
    if (triggered) invokeBot(textarea, /*autoTriggered=*/true);
  } catch (e) {
    alert("Failed to post: " + e.message);
    textarea.value = body;
  }
}

async function refreshDiscussion() {
  if (!state.activeNumber) return;
  const d = await gh.getDiscussion(state.token, state.repo.owner, state.repo.name, state.activeNumber);
  state.activeDiscussion = d;
  cacheSeen(d);
  render();
}

// ---------- Bot invocation ----------
function buildBotMessages(d) {
  const sys = { role: "system", content: cfg.botSystemPrompt };
  const msgs = [sys];
  msgs.push({
    role: "user",
    content:
      `[Discussion #${d.number}: ${d.title}]\n` +
      `(opened by @${d.author?.login})\n\n${d.body}`,
  });
  for (const c of d.comments.nodes) {
    const isBot = isBotAuthor(c.author?.login);
    msgs.push({
      role: isBot ? "assistant" : "user",
      content: isBot ? c.body : `@${c.author?.login}: ${c.body}`,
    });
    for (const r of c.replies.nodes) {
      const rIsBot = isBotAuthor(r.author?.login);
      msgs.push({
        role: rIsBot ? "assistant" : "user",
        content: rIsBot ? r.body : `@${r.author?.login} (reply): ${r.body}`,
      });
    }
  }
  return msgs;
}

async function invokeBot(textarea) {
  if (!state.activeDiscussion || state.postingBot) return;
  state.postingBot = true;
  render();
  try {
    const messages = buildBotMessages(state.activeDiscussion);
    const text = await gh.chatCompletion(
      state.token,
      cfg.modelsEndpoint,
      state.selectedModel,
      messages
    );
    if (!text) throw new Error("Empty response from model.");
    const tagged = `${text}\n\n<sub><i>posted by discuss/chat bot · ${state.selectedModel}</i></sub>`;
    await gh.addComment(state.token, state.activeDiscussion.id, tagged);
    await refreshDiscussion();
  } catch (e) {
    alert("Bot call failed: " + e.message);
  } finally {
    state.postingBot = false;
    render();
  }
}

// ---------- Init ----------
(async function init() {
  const t = auth.loadToken();
  if (t) {
    state.token = t;
    try {
      state.viewer = await gh.getViewer(t);
    } catch {
      auth.clearToken();
      state.token = null;
    }
  }
  const savedRepo = localStorage.getItem("discuss_chat_repo");
  if (savedRepo) {
    try { state.repo = JSON.parse(savedRepo); } catch {}
  } else if (
    cfg.defaultRepo &&
    cfg.defaultRepo.owner !== "YOUR_GITHUB_USERNAME"
  ) {
    state.repo = { ...cfg.defaultRepo };
  }
  render();
  if (state.token && state.repo) bootRepo();
})();
