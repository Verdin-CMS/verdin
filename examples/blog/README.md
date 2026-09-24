# Blog example

A small blog schema showing every Verdin feature: collection and single types, draft &
publish, relations (many-to-one, many-to-many), a reusable component (`shared.seo`) and a
dynamic zone (`blocks.hero`, `blocks.quote`).

```
schema/
  content-types/
    article.json    title, slug (uid), excerpt, body, category, tags, seo, blocks
    category.json   name, slug, articles (inverse side)
    tag.json        label
    homepage.json   single type: hero + featured articles
  components/
    shared/seo.json
    blocks/hero.json, blocks/quote.json
```

## Run it

From the repository root:

```sh
cd examples/blog
cat > .env <<ENV
VERDIN_DATABASE_URL=sqlite://data/blog.db
$(cargo run -q -- secrets)
ENV
mkdir -p data
cargo run -- dev          # migrates, then serves http://localhost:1337
```

Open <http://localhost:1337/admin/> (build the admin first: `cd admin && npm ci && npx ng build`,
then set `[admin] assets_dir` or build the server with `--features embed-admin`), register the
first admin, and create a few articles.

Then read them over the API (after allowing `find` on Article in **Settings → Public access**):

```sh
curl -g 'localhost:1337/api/articles?populate[category]=true&populate[seo]=true&sort=createdAt:desc'
curl -g 'localhost:1337/api/articles?filters[seo][metaTitle][$containsi]=rust'
curl -g 'localhost:1337/api/homepage?populate=*'
```

Any other engine works the same, e.g.
`VERDIN_DATABASE_URL=postgres://verdin:verdin@localhost:5417/verdin` with
`docker compose -f docker/compose.dev.yml up -d --wait`.
