#!/usr/bin/env bash
# Starts `verdin dev` on a throwaway project for the end-to-end tests.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
project="${VERDIN_E2E_PROJECT:?}"
rm -rf "$project" && mkdir -p "$project/schema"
cat > "$project/verdin.toml" <<TOML
[server]
port = 1393

[admin]
secure_cookies = false
assets_dir = "$root/admin/dist/admin/browser"
TOML
export VERDIN_DATABASE_URL="sqlite://$project/data.db"
export VERDIN_ADMIN_JWT_SECRET="e2e-secret-e2e-secret-e2e-secret-e2e"
export VERDIN_TOKEN_PEPPER="e2e-pepper-e2e-pepper-e2e-pepper-e2e"
exec "$root/target/debug/verdin" -c "$project/verdin.toml" dev
