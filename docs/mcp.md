# MCP server

Verdin can serve its content to AI agents through the
[Model Context Protocol](https://modelcontextprotocol.io). Turn it on in
**Settings → Features → MCP server**. The server then answers at `/mcp` on the same host
as the content API, over MCP's Streamable HTTP transport.

## Authentication

Agents authenticate like any content API client: with an API token in
`Authorization: Bearer …`, or with an end user's JWT. Without a token, requests get the
public role's permissions. Every tool checks the same permission as the matching REST
route, so a read-only token can only read.

Browsers that send an `Origin` header are refused unless the origin is listed in the
feature's `allowedOrigins` setting. This protects against DNS rebinding.

## Tools

| Tool | Permission | |
|---|---|---|
| `list_content_types` | `find` or `findOne` | The content types the caller can read, with their attributes |
| `get_content_type` | `find` or `findOne` | A content type's attributes: types, options and relations |
| `find_entries` | `find` | Entries. `query` takes the REST API's parameters as JSON (`filters`, `sort`, `fields`, `populate`, `pagination`); `status: "draft"` needs `readDrafts` |
| `get_entry` | `findOne` | One entry (single types: without `documentId`) |
| `create_entry` | `create` | `data` as in the REST API; `status: "draft"` saves a draft |
| `update_entry` | `update` | Single types: without `documentId` |
| `delete_entry` | `delete` | |
| `publish_entry`, `unpublish_entry` | `publish` | |

Localized types take `locale`. Writes go through the same rules as the REST API:
validation, plugin hooks, review stages, webhooks, history and audit logs.

## Connecting an agent

Claude Code:

```sh
claude mcp add --transport http verdin https://cms.example.com/mcp \
  --header "Authorization: Bearer vd_…"
```

Other clients take the URL and the header in their MCP settings. Use a read-only token
unless the agent should write.
