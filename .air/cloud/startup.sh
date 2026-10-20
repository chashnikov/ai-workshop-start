#!/usr/bin/env bash
# Air cloud startup: Node >= 24 and npm dependencies for Skill Atlas (a CLI; no server to start).
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ "${AIR_STARTUP_MODE:-}" = warmup ]; then WARMUP=1; else WARMUP=; fi

NODE_MAJOR_REQUIRED=24
NODE_FALLBACK_VERSION=v24.11.1
ENV_FILE="$HOME/.skill-atlas-env.sh"

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

# Node runs src/*.ts directly, so it must be >= 24 (package.json engines). Use the preinstalled one
# when it is recent enough; otherwise fetch a userspace Node tarball and put it on PATH for login shells.
if [ "$(node_major)" -lt "$NODE_MAJOR_REQUIRED" ]; then
  [ -f "$ENV_FILE" ] && . "$ENV_FILE"
fi
if [ "$(node_major)" -lt "$NODE_MAJOR_REQUIRED" ]; then
  echo "[startup] node $(node -v 2>/dev/null || echo missing) < $NODE_MAJOR_REQUIRED; installing $NODE_FALLBACK_VERSION in ~/.local/node"
  arch=$(uname -m); case "$arch" in x86_64) arch=x64 ;; aarch64) arch=arm64 ;; esac
  mkdir -p "$HOME/.local/node"
  curl -fsSL "https://nodejs.org/dist/$NODE_FALLBACK_VERSION/node-$NODE_FALLBACK_VERSION-linux-$arch.tar.xz" \
    | tar -xJ -C "$HOME/.local/node" --strip-components=1
  echo "export PATH=\"\$HOME/.local/node/bin:\$PATH\"" > "$ENV_FILE"
  . "$ENV_FILE"
  line="[ -f \"$ENV_FILE\" ] && . \"$ENV_FILE\"  # skill-atlas-env"
  profile="$HOME/.profile"
  for p in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do [ -f "$p" ] && { profile=$p; break; }; done
  for rc in "$profile" "$HOME/.bashrc"; do
    grep -q 'skill-atlas-env' "$rc" 2>/dev/null || echo "$line" >> "$rc"
  done
fi
echo "[startup] node $(node -v), npm $(npm -v)"

echo "[startup] npm ci"
npm ci --no-audit --no-fund
echo "[startup] dependencies installed"

# The same checks as CI (.github/workflows/ci.yml): typecheck, tests, and the real CLI on the fixture.
healthcheck() {
  echo "[healthcheck] typecheck"
  npm run typecheck
  echo "[healthcheck] tests"
  npm test
  echo "[healthcheck] CLI smoke test"
  ./skill-atlas help
  ./skill-atlas scan ./fixture
  echo "[healthcheck] OK"
}

if [ -n "${WARMUP:-}" ]; then healthcheck; fi
