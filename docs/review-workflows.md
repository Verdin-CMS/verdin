# Review workflows

A review workflow is an ordered list of stages, such as *To do*, *In review* and
*Ready*. The entries of its content types move through these stages. Turn the feature
on in **Settings → Features → Review workflows**, then set up workflows in
**Settings → Review workflows** (permission `workflows.manage`).

## Workflows

Each workflow has:

- **Content types.** A content type belongs to at most one workflow.
- **Stages**, in order, each with a name and a color. New entries start at the first
  stage. So do entries that existed before their type joined the workflow.
- **Roles per stage (optional).** Only admins with one of these roles can move entries
  *into* the stage. When no roles are set, anyone who can update the entry can.
  Admins with `workflows.manage` can always move entries.
- **A stage required to publish (optional).** When one is set, an entry can be
  published only while it is in that stage. This applies to every API: the admin,
  REST, GraphQL, releases and plugins. Otherwise the publication fails with
  `400 the entry must be in the review stage "Ready" to be published`.

When you remove a stage, its entries go back to the first stage. When you remove a
content type from a workflow, its entries lose their stages.

## Entries

The entry editor shows the current stage and the assignee. The list view shows a
**Stage** column. The home page lists the entries assigned to you.

- Anyone who can update an entry can assign it to an admin. The assignee must be able
  to read the content type.
- Stages are kept per locale for localized types.
- Stage changes and assignments are recorded in the audit logs as `entry.stage` and
  `entry.assign`.

## API

All routes are under `/admin/api`.

| Route | Permission | |
|---|---|---|
| `GET /review-workflows`, `GET /review-workflows/{id}` | `workflows.manage` | Workflows with their stages |
| `POST /review-workflows`, `PUT /review-workflows/{id}` | `workflows.manage` | Create or replace a workflow (see below) |
| `DELETE /review-workflows/{id}` | `workflows.manage` | Entries of its types lose their stages |
| `GET /content/{uid}/{documentId}/review?locale=` | read the entry | Stage, assignee, and the stages you can move the entry to (`canMoveTo`) |
| `PUT /content/{uid}/{documentId}/review?locale=` | update the entry | `{ "stageId": 3, "assigneeId": 7 }`. Either field is optional, and `"assigneeId": null` removes the assignee |
| `GET /content/{uid}/review?documentIds=a,b` | read the type | Stages of several entries (up to 200), with the workflow in `meta.workflow` |
| `GET /review/assigned` | signed in | Entries assigned to you |
| `GET /review/assignees?uid=` | update the type | Active admins who can read the type, to assign entries to |
| `GET /review/roles` | `workflows.manage` | Role codes and names, for stage permissions |

A workflow as sent to `POST` and `PUT`:

```json
{
  "name": "Editorial",
  "contentTypes": ["api::article"],
  "stages": [
    { "id": 1, "name": "To do", "color": "#4945ff" },
    { "id": 2, "name": "In review", "color": "#ff8800" },
    { "name": "Ready", "color": "#2f9e44", "roles": ["editor"] }
  ],
  "publishStage": "Ready"
}
```

Send existing stages with their `id` so that their entries stay where they are.
Stages without an `id` are new.

## Differences from Strapi

Strapi's review workflows are an Enterprise feature. In Verdin they are part of the
open-source core. They work the same way, with these differences:

- Roles per stage limit who moves entries *into* a stage.
- The publish stage applies to every API, not only to the admin.
