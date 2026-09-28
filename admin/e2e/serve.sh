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
# A plugin (the runtime tests' sample module) with a route, a widget and a custom field.
plugin="$project/plugins/sample"
mkdir -p "$plugin/admin"
cp "$root/crates/verdin-plugins/tests/fixtures/sample.wasm" "$plugin/plugin.wasm"
cat > "$plugin/plugin.toml" <<'TOML'
name = "sample"
version = "0.1.0"
description = "Greetings, a widget and a color field"
[capabilities]
kv = true
[routes]
function = "handle"
[admin]
script = "index.js"
[[admin.widgets]]
id = "hello"
title = "Hello widget"
element = "sample-hello"
[[admin.fields]]
id = "color"
title = "Color"
element = "sample-color"
type = "string"
TOML
cat > "$plugin/admin/index.js" <<'JS'
customElements.define('sample-hello', class extends HTMLElement {
  connectedCallback() {
    this.textContent = 'Hello from the sample plugin';
  }
});
customElements.define('sample-color', class extends HTMLElement {
  connectedCallback() {
    const input = document.createElement('input');
    input.type = 'text';
    input.setAttribute('aria-label', 'Color value');
    input.value = this.value ?? '';
    input.addEventListener('input', () =>
      this.dispatchEvent(new CustomEvent('change', { detail: input.value })),
    );
    this.append(input);
  }
});
JS
export VERDIN_DATABASE_URL="sqlite://$project/data.db"
export VERDIN_ADMIN_JWT_SECRET="e2e-secret-e2e-secret-e2e-secret-e2e"
export VERDIN_TOKEN_PEPPER="e2e-pepper-e2e-pepper-e2e-pepper-e2e"
exec "$root/target/debug/verdin" -c "$project/verdin.toml" dev
