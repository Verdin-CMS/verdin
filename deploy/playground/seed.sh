#!/bin/sh
# Seeds a fresh playground database: a Super Admin nobody knows the password of, the
# public demo account (Editor role), public read access to the blog types and a few
# published entries. Called by run.sh once the server answers; needs curl and jq.
set -eu

BASE="http://127.0.0.1:${VERDIN_SERVER__PORT:-1337}"
DEMO_EMAIL="${PLAYGROUND_EMAIL:-demo@example.com}"
DEMO_PASSWORD="${PLAYGROUND_PASSWORD:-verdin-demo-1234}"
OWNER_EMAIL="owner@playground.invalid"
OWNER_PASSWORD="$(verdin secrets | sed -n 's/^VERDIN_TOKEN_PEPPER=//p')Aa1!"

say() { printf 'playground-seed: %s\n' "$*" >&2; }

# POST/PUT JSON with the owner's session; prints the response body.
call() {
    method="$1" path="$2" body="$3"
    if ! out="$(curl -sS --fail-with-body -X "$method" "$BASE$path" \
        -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "$body")"; then
        say "$method $path failed: $out"
        return 1
    fi
    printf '%s' "$out"
}

VERDIN_ADMIN_PASSWORD="$OWNER_PASSWORD" verdin admin create --email "$OWNER_EMAIL" >/dev/null
TOKEN="$(curl -fsS -X POST "$BASE/admin/api/auth/login" -H 'content-type: application/json' \
    -d "$(jq -n --arg e "$OWNER_EMAIL" --arg p "$OWNER_PASSWORD" '{email: $e, password: $p}')" \
    | jq -r '.data.accessToken')"

# The demo account: an Editor, so visitors cannot manage users, roles, tokens, webhooks
# or settings.
editor="$(curl -fsS "$BASE/admin/api/roles?pageSize=100" -H "authorization: Bearer $TOKEN" \
    | jq -r '.data[] | select(.code == "editor" or .name == "Editor") | .id' | head -n 1)"
[ -n "$editor" ] || { say "no Editor role found"; exit 1; }
call POST /admin/api/users "$(jq -n --arg e "$DEMO_EMAIL" --arg p "$DEMO_PASSWORD" --argjson r "$editor" \
    '{email: $e, password: $p, firstname: "Demo", lastname: "Visitor", roles: [$r]}')" >/dev/null

# Anyone can read the published content over REST and GraphQL.
grants=""
for subject in api::article api::category api::tag; do
    grants="$grants{\"subject\":\"$subject\",\"action\":\"find\"},{\"subject\":\"$subject\",\"action\":\"findOne\"},"
done
call PUT /admin/api/public-permissions \
    "{\"permissions\":[$grants{\"subject\":\"api::homepage\",\"action\":\"find\"}]}" >/dev/null

# Content, through the admin content API (the same calls the panel makes).
create() { # <uid> <json data> [publish] → documentId
    id="$(call POST "/admin/api/content/$1" "{\"data\":$2}" | jq -r '.data.documentId')"
    if [ "${3:-}" = publish ]; then
        call POST "/admin/api/content/$1/$id/actions/publish" '{}' >/dev/null
    fi
    printf '%s' "$id"
}

news="$(create api::category '{"name":"News"}')"
guides="$(create api::category '{"name":"Guides"}')"
rust="$(create api::tag '{"label":"rust"}')"
cms="$(create api::tag '{"label":"cms"}')"

create api::article "$(jq -n --arg c "$news" --arg t1 "$rust" --arg t2 "$cms" '{
  title: "Welcome to the Verdin playground", slug: "welcome",
  excerpt: "A shared demo instance. Everything here is wiped every hour.",
  body: "Sign in to the admin panel with the demo account, edit this article, publish it and read it back from the API.",
  readingTime: 1, featured: true, category: $c, tags: [$t1, $t2],
  seo: {metaTitle: "Verdin playground", metaDescription: "Try Verdin in your browser."},
  blocks: [{__component: "blocks.hero", title: "Hello", subtitle: "Edit me in the admin panel."}]
}')" publish >/dev/null
create api::article "$(jq -n --arg c "$guides" --arg t "$cms" '{
  title: "Reading content over REST", slug: "reading-content-over-rest",
  excerpt: "GET /api/articles?populate=* returns the published articles with their relations.",
  body: "Try `/api/articles?populate=*`, `/api/articles?filters[featured][$eq]=true` or the GraphQL endpoint at `/graphql`.",
  readingTime: 2, category: $c, tags: [$t],
  blocks: [{__component: "blocks.quote", text: "One binary, the admin panel built in."}]
}')" publish >/dev/null
create api::article "$(jq -n --arg c "$guides" '{
  title: "A draft nobody has published yet", slug: "a-draft",
  excerpt: "Drafts are only visible in the admin panel and to tokens that ask for them.",
  category: $c
}')" >/dev/null
create api::homepage '{"headline":"Verdin playground","seo":{"metaTitle":"Verdin playground"}}' publish >/dev/null

say "seeded; demo account: $DEMO_EMAIL"
