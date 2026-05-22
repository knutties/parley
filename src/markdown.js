// markdown.js — minimal markdown -> HTML
// We could use GitHub's bodyHTML directly (already-rendered), and we do for
// existing comments. For bot streaming preview and local rendering we use
// this tiny safe-ish renderer.

function escape(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;",
  })[c]);
}

export function renderMarkdown(src) {
  if (!src) return "";
  let s = src;

  // Extract fenced code blocks first so we don't process markdown inside them
  const blocks = [];
  s = s.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    const i = blocks.length;
    blocks.push(`<pre><code class="lang-${escape(lang || "")}">${escape(code)}</code></pre>`);
    return `\x00${i}\x00`;
  });

  // Escape remaining HTML
  s = escape(s);

  // Inline code
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");

  // Bold + italic (simple)
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  // Links [text](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Headers
  s = s.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  s = s.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  s = s.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Blockquotes
  s = s.replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>");

  // Lists (simple)
  s = s.replace(/(^|\n)((?:[-*] .+\n?)+)/g, (_, pre, block) => {
    const items = block.trim().split("\n").map((l) => `<li>${l.replace(/^[-*]\s+/, "")}</li>`).join("");
    return `${pre}<ul>${items}</ul>`;
  });

  // Paragraphs
  s = s.split(/\n{2,}/).map((p) => {
    if (/^<(h\d|ul|ol|pre|blockquote)/.test(p.trim())) return p;
    return `<p>${p.replace(/\n/g, "<br>")}</p>`;
  }).join("\n");

  // Restore code blocks
  s = s.replace(/\x00(\d+)\x00/g, (_, i) => blocks[+i]);

  return s;
}
