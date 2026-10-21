#!/usr/bin/env sh
# Assembles everything the desktop installer needs under apps/desktop/runtime:
#   runtime/api/        self-contained API (pnpm deploy) + generated Prisma client
#   runtime/node        Node binary for the TARGET machine (override: DASHDIALER_NODE_BIN)
#   runtime/seed.db     EMPTY-schema SQLite database (never the developer's dev.db)
# and builds apps/web/dist.
set -e
ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

RUNTIME="apps/desktop/runtime"
NODE_BIN="${DASHDIALER_NODE_BIN:-$(command -v node || true)}"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "ERROR: Node binary not found. Set DASHDIALER_NODE_BIN=/path/to/node" >&2
  exit 1
fi

echo "==> Building shared packages, API and web UI"
pnpm --filter @powerdialer/shared --filter @powerdialer/providers --filter @powerdialer/api run build
pnpm --filter @powerdialer/web run build

echo "==> Assembling self-contained API runtime"
rm -rf "$RUNTIME"
mkdir -p "$RUNTIME"
pnpm --filter @powerdialer/api deploy --prod "$RUNTIME/api"
# Generate Prisma client inside the deployed tree (engines for this OS/arch).
"$NODE_BIN" apps/api/node_modules/prisma/build/index.js generate --schema "$RUNTIME/api/prisma/schema.prisma"
# Strip sources/dev-only files from the shipped runtime.
rm -rf "$RUNTIME/api/src" "$RUNTIME/api/tsconfig.json" "$RUNTIME/api/scripts" "$RUNTIME/api/prisma/dev.db" "$RUNTIME/api/prisma/dev.db-journal" "$RUNTIME/api/.env"

echo "==> Creating empty-schema seed database"
SEED_TMP="$(mktemp -d)/seed.db"
DATABASE_URL="file:$SEED_TMP" "$NODE_BIN" apps/api/node_modules/prisma/build/index.js db push --schema apps/api/prisma/schema.prisma --skip-generate --accept-data-loss >/dev/null
cp "$SEED_TMP" "$RUNTIME/seed.db"

echo "==> Bundling Node binary ($NODE_BIN)"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) cp "$NODE_BIN" "$RUNTIME/node.exe" ;;
  *) cp "$NODE_BIN" "$RUNTIME/node" && chmod +x "$RUNTIME/node" ;;
esac
echo "    Node arch: $(file "$RUNTIME/node" 2>/dev/null | sed 's/.*: //')"
echo "    NOTE: the bundled Node must match the installer's target OS/arch."
echo "          For an Apple Silicon build on an Intel Mac (or vice versa), set"
echo "          DASHDIALER_NODE_BIN to a Node download for that architecture."

echo "==> Installing desktop dev dependencies"
pnpm --filter @powerdialer/desktop install

du -sh "$RUNTIME" | sed 's/^/    runtime size: /'
echo "Desktop prep done. Next: pnpm --filter @powerdialer/desktop run dist:mac   (or dist:win)"
