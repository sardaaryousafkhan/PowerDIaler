"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

/**
 * Tiny static file server with /api reverse-proxy to the local Fastify API.
 * Binds to 127.0.0.1 only. Proxy streams request/response bodies (CSV uploads, audio).
 */
function startStaticServer({ webRoot, apiOrigin, host = "127.0.0.1", port = 0 }) {
  const api = new URL(apiOrigin);
  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url || "/", `http://${host}`);
      if (u.pathname === "/api" || u.pathname.startsWith("/api/")) {
        proxyApi(req, res, api, u);
        return;
      }
      serveStatic(webRoot, u.pathname, res);
    } catch (err) {
      res.statusCode = 500;
      res.end(String(err && err.message ? err.message : err));
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        server,
        port: p,
        origin: `http://${host}:${p}`,
        close: () =>
          new Promise((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}

function serveStatic(webRoot, pathname, res) {
  let rel = decodeURIComponent(pathname.split("?")[0] || "/");
  if (rel === "/") rel = "/index.html";
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(webRoot, safe);
  if (!filePath.startsWith(webRoot)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback for client-side routes
    filePath = path.join(webRoot, "index.html");
  }
  if (!fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
  if (ext === ".html") res.setHeader("Cache-Control", "no-store");
  fs.createReadStream(filePath).pipe(res);
}

function proxyApi(req, res, api, u) {
  const targetPath = (u.pathname.replace(/^\/api/, "") || "/") + u.search;
  const headers = { ...req.headers, host: api.host };
  // Hop-by-hop headers must not be forwarded.
  delete headers.connection;
  delete headers["keep-alive"];
  delete headers["proxy-connection"];
  delete headers.upgrade;

  const upstream = http.request(
    {
      hostname: api.hostname,
      port: api.port,
      method: req.method,
      path: targetPath,
      headers,
    },
    (upRes) => {
      const outHeaders = { ...upRes.headers };
      delete outHeaders.connection;
      delete outHeaders["keep-alive"];
      res.writeHead(upRes.statusCode || 502, outHeaders);
      upRes.pipe(res);
    },
  );

  upstream.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: "Local API unavailable", detail: err.message }));
  });

  req.pipe(upstream);
}

module.exports = { startStaticServer };
