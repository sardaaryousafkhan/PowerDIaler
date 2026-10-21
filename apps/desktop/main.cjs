"use strict";

const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const net = require("net");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { startStaticServer } = require("./static-server.cjs");
const license = require("./license-store.cjs");

let mainWindow = null;
let apiChild = null;
let staticHandle = null;
let apiPort = 0;
let uiOrigin = "";
let shuttingDown = false;
let shutdownPromise = null;

const HEARTBEAT_MS = 4 * 60 * 60 * 1000;
// API trusts the state file for a bit longer than one heartbeat so a single
// failed/slow heartbeat does not lock paid features mid-call.
const STATE_TTL_MS = 6 * 60 * 60 * 1000;
let heartbeatTimer = null;

// Per-launch secret shared only with the child API process (env), used to sign
// the license state file the API reads before allowing paid endpoints.
const LICENSE_STATE_SECRET = crypto.randomBytes(32).toString("hex");

function isDev() {
  return !app.isPackaged;
}

function repoRoot() {
  // apps/desktop -> repo root
  return path.resolve(__dirname, "..", "..");
}

function userDataDir() {
  return app.getPath("userData");
}

function resourcesDir() {
  return process.resourcesPath || path.join(__dirname, "resources");
}

function licenseStateFile() {
  return path.join(userDataDir(), "license-state.json");
}

// ---------------------------------------------------------------------------
// Runtime discovery (packaged vs dev)
// Packaged layout (see scripts/prepare-desktop.sh):
//   resources/web-dist/                  built React UI
//   resources/runtime/seed.db            empty-schema SQLite seed
//   resources/runtime/node[.exe]         Node binary matching target OS/arch
//   resources/runtime/api/dist/server.js self-contained API (pnpm deploy)
// ---------------------------------------------------------------------------
function findNodeBinary() {
  if (process.env.DASHDIALER_NODE && fs.existsSync(process.env.DASHDIALER_NODE)) {
    return process.env.DASHDIALER_NODE;
  }
  const bundled = path.join(resourcesDir(), "runtime", process.platform === "win32" ? "node.exe" : "node");
  if (fs.existsSync(bundled)) return bundled;
  if (isDev()) {
    const devCandidates = [
      process.env.npm_node_execpath,
      "/Library/Frameworks/Python.framework/Versions/3.13/lib/python3.13/site-packages/playwright/driver/node",
      "/usr/local/bin/node",
      "/opt/homebrew/bin/node",
    ].filter(Boolean);
    for (const c of devCandidates) if (fs.existsSync(c)) return c;
    return "node";
  }
  return null;
}

function findApiEntry() {
  const bundledDir = path.join(resourcesDir(), "runtime", "api");
  const bundledJs = path.join(bundledDir, "dist", "server.js");
  if (fs.existsSync(bundledJs)) return { cwd: bundledDir, args: [bundledJs], mode: "bundled" };

  if (isDev()) {
    const apiCwd = path.join(repoRoot(), "apps", "api");
    const tsxCli = path.join(apiCwd, "node_modules", "tsx", "dist", "cli.mjs");
    const serverTs = path.join(apiCwd, "src", "server.ts");
    const serverJs = path.join(apiCwd, "dist", "server.js");
    if (fs.existsSync(serverJs)) return { cwd: apiCwd, args: [serverJs], mode: "dev-dist" };
    if (fs.existsSync(tsxCli) && fs.existsSync(serverTs)) return { cwd: apiCwd, args: [tsxCli, serverTs], mode: "dev-tsx" };
  }
  return null;
}

function webDistPath() {
  if (app.isPackaged) return path.join(resourcesDir(), "web-dist");
  return path.join(repoRoot(), "apps", "web", "dist");
}

function ensureUserDb() {
  const dest = path.join(userDataDir(), "dashdialer.db");
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  const candidates = [
    path.join(resourcesDir(), "runtime", "seed.db"),
    isDev() ? path.join(repoRoot(), "apps", "desktop", "runtime", "seed.db") : null,
    isDev() ? path.join(repoRoot(), "apps", "api", "prisma", "dev.db") : null,
  ].filter(Boolean);
  for (const src of candidates) {
    if (fs.existsSync(src)) {
      fs.mkdirSync(userDataDir(), { recursive: true });
      fs.copyFileSync(src, dest);
      return dest;
    }
  }
  throw new Error(
    "DashDialer could not find its database template (runtime/seed.db). Please reinstall the app.",
  );
}

// Per-install secrets: generated once, stored in userData so sessions survive restarts.
function ensureLocalSecrets() {
  const p = path.join(userDataDir(), "local-secrets.json");
  try {
    const existing = JSON.parse(fs.readFileSync(p, "utf8"));
    if (existing && typeof existing.authSecret === "string" && existing.authSecret.length >= 32) return existing;
  } catch {
    // create below
  }
  const fresh = { authSecret: crypto.randomBytes(32).toString("hex") };
  fs.mkdirSync(userDataDir(), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(fresh, null, 2), { encoding: "utf8", mode: 0o600 });
  return fresh;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

async function waitForHealth(origin, attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    if (!apiChild) return false; // process died
    try {
      const res = await fetch(`${origin}/health`);
      if (res.ok) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// ---------------------------------------------------------------------------
// License state → API gate
// ---------------------------------------------------------------------------
function writeLicenseState(status) {
  const skip = license.skipLicense();
  const data = {
    ok: skip ? true : Boolean(status && status.ok),
    status: skip ? "active" : (status && status.status) || "inactive",
    reason: skip ? "dev_skip" : (status && status.reason) || "unknown",
    until: Date.now() + STATE_TTL_MS,
  };
  const sig = crypto.createHmac("sha256", LICENSE_STATE_SECRET).update(JSON.stringify(data)).digest("hex");
  fs.mkdirSync(userDataDir(), { recursive: true });
  fs.writeFileSync(licenseStateFile(), JSON.stringify({ data, sig }), { encoding: "utf8", mode: 0o600 });
  return data;
}

async function refreshLicense(opts = {}) {
  let result;
  try {
    result = await license.verifyRemote(userDataDir(), opts);
  } catch (err) {
    result = { ...license.getLicenseStatus(userDataDir()), error: err instanceof Error ? err.message : String(err) };
  }
  writeLicenseState(result);
  return result;
}

// ---------------------------------------------------------------------------
// Start/stop
// ---------------------------------------------------------------------------
async function startApi() {
  const nodeBin = findNodeBinary();
  const entry = findApiEntry();
  if (!nodeBin || !entry) {
    throw new Error(
      "DashDialer is missing its local engine (runtime/node or runtime/api). " +
        (isDev()
          ? "Run `pnpm desktop:prep` first."
          : "Please reinstall the app or contact hello@derivedstudio.com."),
    );
  }

  apiPort = await getFreePort();
  const dbFile = ensureUserDb();
  const secrets = ensureLocalSecrets();
  const apiOrigin = `http://127.0.0.1:${apiPort}`;

  // Write an initial (locked unless dev-skip) state before the API boots.
  writeLicenseState(license.getLicenseStatus(userDataDir()));

  const env = {
    // Start from a minimal env so a customer's shell variables cannot alter the engine.
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    TMPDIR: process.env.TMPDIR,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    SystemRoot: process.env.SystemRoot,
    DEMO_MODE: process.env.DEMO_MODE || "1",
    NODE_ENV: process.env.DASHDIALER_NODE_ENV || "development",
    HOST: "127.0.0.1",
    PORT: String(apiPort),
    DATABASE_URL: `file:${dbFile}`,
    PUBLIC_BASE_URL: apiOrigin,
    PUBLIC_WEB_URL: "http://127.0.0.1",
    CORS_ALLOWED_ORIGINS: "",
    AUTH_SECRET: secrets.authSecret,
    DASHDIALER_LICENSE_STATE_FILE: licenseStateFile(),
    DASHDIALER_LICENSE_SECRET: LICENSE_STATE_SECRET,
  };
  for (const k of Object.keys(env)) if (env[k] === undefined) delete env[k];

  // Dev only: pull provider keys etc. from apps/api/.env (never overrides the values above).
  if (isDev()) {
    const envFile = path.join(repoRoot(), "apps", "api", ".env");
    if (fs.existsSync(envFile)) {
      for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
        if (!m) continue;
        const val = m[2].replace(/^["']|["']$/g, "");
        if (env[m[1]] === undefined) env[m[1]] = val;
      }
    }
  }

  // Customer-provided provider settings (Twilio/RingCentral) live in userData/engine.env.
  const customerEnv = path.join(userDataDir(), "engine.env");
  if (fs.existsSync(customerEnv)) {
    for (const line of fs.readFileSync(customerEnv, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      if (["HOST", "PORT", "DATABASE_URL", "AUTH_SECRET", "DASHDIALER_LICENSE_STATE_FILE", "DASHDIALER_LICENSE_SECRET"].includes(key)) continue;
      env[key] = m[2].replace(/^["']|["']$/g, "");
    }
  }

  apiChild = spawn(nodeBin, entry.args, {
    cwd: entry.cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  console.log(`[desktop] API mode=${entry.mode} node=${nodeBin} port=${apiPort}`);

  apiChild.stdout.on("data", (d) => console.log(`[api] ${d}`.trimEnd()));
  apiChild.stderr.on("data", (d) => console.error(`[api] ${d}`.trimEnd()));
  apiChild.on("exit", (code) => {
    console.log(`[api] exited code=${code}`);
    apiChild = null;
    if (!shuttingDown && mainWindow) {
      dialog.showErrorBox(
        "DashDialer engine stopped",
        "The local dialing engine stopped unexpectedly. Please quit and reopen DashDialer.",
      );
    }
  });

  const ok = await waitForHealth(apiOrigin);
  if (!ok) throw new Error("Local engine failed to start. Please reopen DashDialer; if it keeps failing, reinstall.");
  return apiOrigin;
}

async function startUi(apiOrigin) {
  const webRoot = webDistPath();
  if (!fs.existsSync(path.join(webRoot, "index.html"))) {
    throw new Error(`Web build missing at ${webRoot}. Run: pnpm --filter @powerdialer/web run build`);
  }
  staticHandle = await startStaticServer({ webRoot, apiOrigin, host: "127.0.0.1", port: 0 });
  uiOrigin = staticHandle.origin;
  return uiOrigin;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "DashDialer",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Keep navigation inside the local UI; external links open in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(uiOrigin)) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.loadURL(`${uiOrigin}/login`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function shutdown() {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = (async () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (staticHandle) {
      try {
        await staticHandle.close();
      } catch {
        // ignore
      }
      staticHandle = null;
    }
    if (apiChild) {
      const child = apiChild;
      apiChild = null;
      await new Promise((resolve) => {
        const t = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // ignore
          }
          resolve();
        }, 3000);
        child.once("exit", () => {
          clearTimeout(t);
          resolve();
        });
        try {
          child.kill("SIGTERM");
        } catch {
          clearTimeout(t);
          resolve();
        }
      });
    }
    try {
      fs.unlinkSync(licenseStateFile());
    } catch {
      // ignore
    }
  })();
  return shutdownPromise;
}

function registerIpc() {
  ipcMain.handle("license:status", async () => license.getLicenseStatus(userDataDir()));
  ipcMain.handle("license:activate", async (_e, key) => refreshLicense({ licenseKey: String(key || "") }));
  ipcMain.handle("license:refresh", async () => refreshLicense({}));
  ipcMain.handle("license:clear", async () => {
    license.clearCache(userDataDir());
    const status = license.getLicenseStatus(userDataDir());
    writeLicenseState(status);
    return status;
  });
  ipcMain.handle("shell:openExternal", async (_e, url) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      await shell.openExternal(url);
      return { ok: true };
    }
    return { ok: false };
  });
}

// Single instance: a second launch focuses the existing window instead of
// starting a second engine against the same database.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    registerIpc();
    // Dev convenience only: unpackaged runs skip the license unless told otherwise.
    // Packaged builds never auto-skip.
    if (isDev() && process.env.DASHDIALER_SKIP_LICENSE === undefined) {
      process.env.DASHDIALER_SKIP_LICENSE = "1";
    }
    if (!isDev() && license.skipLicense()) {
      // Refuse to honour a skip flag leaked into a customer environment.
      delete process.env.DASHDIALER_SKIP_LICENSE;
    }

    try {
      const apiOrigin = await startApi();
      await startUi(apiOrigin);
      createWindow();

      // Verify license now (writes state file), then every 4h.
      refreshLicense({}).catch(() => {});
      heartbeatTimer = setInterval(() => {
        refreshLicense({}).catch(() => {});
      }, HEARTBEAT_MS);
    } catch (err) {
      console.error(err);
      dialog.showErrorBox("DashDialer could not start", err instanceof Error ? err.message : String(err));
      await shutdown();
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    // Keep the engine alive on macOS so reopening from the Dock is instant;
    // quit fully elsewhere.
    if (process.platform !== "darwin") app.quit();
  });

  let quitReady = false;
  app.on("before-quit", (e) => {
    if (quitReady) return;
    e.preventDefault();
    shutdown().finally(() => {
      quitReady = true;
      app.quit();
    });
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && uiOrigin && !shuttingDown) createWindow();
  });
}
