/**
 * Same-origin gateway: static web UI + /api → Fastify (strips /api prefix).
 * Keeps the browser dialer working without a separate Vite proxy.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.HOSTED_ROOT || path.resolve(__dirname, "../..");
const WEB_DIST = process.env.WEB_DIST || path.join(ROOT, "apps/web/dist");
const API_HOST = process.env.API_HOST || "127.0.0.1";
const API_PORT = Number(process.env.PORT || 4000);
const GATEWAY_PORT = Number(process.env.GATEWAY_PORT || 8080);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
    "cache-control": ext === ".html" ? "no-cache" : "public, max-age=86400",
  });
  fs.createReadStream(filePath).pipe(res);
}

function proxyApi(req, res) {
  const targetPath = req.url.replace(/^\/api/, "") || "/";
  const headers = { ...req.headers, host: `${API_HOST}:${API_PORT}` };
  delete headers["accept-encoding"];
  const upstream = http.request(
    {
      hostname: API_HOST,
      port: API_PORT,
      path: targetPath,
      method: req.method,
      headers,
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "API unavailable", detail: String(err.message || err) }));
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  if (url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, role: "gateway" }));
    return;
  }
  if (url.startsWith("/api/") || url === "/api") {
    proxyApi(req, res);
    return;
  }

  const rel = decodeURIComponent(url.split("?")[0]).replace(/^\//, "") || "index.html";
  const candidate = path.normalize(path.join(WEB_DIST, rel));
  if (!candidate.startsWith(WEB_DIST)) {
    res.writeHead(400).end("Bad path");
    return;
  }
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    sendFile(res, candidate);
    return;
  }
  // SPA fallback
  const index = path.join(WEB_DIST, "index.html");
  if (fs.existsSync(index)) {
    sendFile(res, index);
    return;
  }
  res.writeHead(503, { "content-type": "text/plain" });
  res.end("Web UI not built (missing apps/web/dist)");
});

server.listen(GATEWAY_PORT, "0.0.0.0", () => {
  console.log(`DashDialer gateway on http://0.0.0.0:${GATEWAY_PORT} (UI + /api → :${API_PORT})`);
});
