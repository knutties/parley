// Local development server for parley.
//
// Serves the static app and provides a small same-origin proxy for the few
// GitHub endpoints browsers cannot call directly because of CORS.

const { createReadStream } = require("node:fs");
const { readFile } = require("node:fs/promises");
const { createServer } = require("node:http");
const { extname, join, normalize } = require("node:path");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const maxBodyBytes = 2048;

const allowedTargets = new Map([
  ["https://github.com/login/device/code", new Set(["POST"])],
  ["https://github.com/login/oauth/access_token", new Set(["POST"])],
  ["https://models.github.ai/catalog/models", new Set(["GET"])],
]);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname === "/proxy") {
      await proxyRequest(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    send(res, 500, "Internal server error");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`parley dev server running at http://localhost:${port}`);
});

async function proxyRequest(req, res, url) {
  const target = url.searchParams.get("url");
  const methods = allowedTargets.get(target);
  if (!methods) {
    send(res, 403, "forbidden target");
    return;
  }
  if (!methods.has(req.method)) {
    send(res, 405, "method not allowed");
    return;
  }

  const headers = {
    Accept: "application/json",
    "User-Agent": "parley-dev-server",
  };
  const incomingAuth = req.headers.authorization;
  if (incomingAuth) headers.Authorization = incomingAuth;

  let body;
  if (req.method === "POST") {
    body = await readBody(req);
    if (body.length > maxBodyBytes) {
      send(res, 413, "body too large");
      return;
    }
    headers["Content-Type"] = "application/json";
  }

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body,
  });
  const text = await upstream.text();
  send(res, upstream.status, text, {
    "Content-Type": upstream.headers.get("content-type") || "application/json",
  });
}

async function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "method not allowed");
    return;
  }

  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(root, pathname));
  if (!filePath.startsWith(root)) {
    send(res, 403, "forbidden");
    return;
  }

  try {
    if (req.method === "HEAD") {
      await readFile(filePath);
      send(res, 200, "", contentHeaders(filePath));
      return;
    }
    res.writeHead(200, contentHeaders(filePath));
    createReadStream(filePath).pipe(res);
  } catch {
    send(res, 404, "not found");
  }
}

function contentHeaders(filePath) {
  return {
    "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
  };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBodyBytes) req.destroy(new Error("body too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}
