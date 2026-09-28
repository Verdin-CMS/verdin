# Single sign-on (OpenID Connect)

Admins can sign in through any OpenID Connect provider: Google Workspace, Microsoft Entra
ID, Okta, Auth0, Keycloak, Authentik, GitLab and others. Password sign-in keeps working
next to it.

## Setting it up

1. Register an application (a "web" client) at the provider, with this redirect URI:

   ```
   https://<your server>/admin/api/auth/sso/<id>/callback
   ```

   `<your server>` comes from `[server].public_url`. Set it when Verdin runs behind a
   proxy. `<id>` is the provider id you choose below. The settings dialog shows the URI
   with the address you opened the admin at. If `public_url` is different, use
   `public_url` instead.

2. Put the client secret in the environment, then restart Verdin:

   ```sh
   VERDIN_SSO_<ID>_SECRET=…     # e.g. VERDIN_SSO_CORP_SECRET for the id `corp`
   ```

   Public clients (PKCE only, no secret) need no variable.

3. Turn on **Settings → Features → Single sign-on** and give it providers:

```json
{
  "providers": [
    {
      "id": "corp",
      "name": "Corp account",
      "issuer": "https://login.microsoftonline.com/<tenant>/v2.0",
      "clientId": "…",
      "scopes": ["openid", "email", "profile"],
      "autoCreate": true,
      "defaultRoles": ["author"],
      "roleClaim": "groups",
      "roleMap": { "<group id>": "editor", "<admins group id>": "super-admin" },
      "allowedDomains": ["corp.example"]
    }
  ]
}
```

| Setting | |
|---|---|
| `id` | Lowercase letters, digits and dashes. Appears in URLs and in the secret's variable name |
| `name` | The text of the login button |
| `issuer` | The provider's issuer URL. Verdin reads `/.well-known/openid-configuration` under it. It must use HTTPS, except on `localhost` |
| `clientId` | The application's client id |
| `scopes` | Default `openid email profile`. Must include `openid` |
| `autoCreate` | Create an admin account on first sign-in. Without it, only emails that already have an account may sign in |
| `defaultRoles` | Role codes for created accounts when `roleClaim` maps to none |
| `roleClaim`, `roleMap` | The ID token claim that lists the user's groups, and which role code each group gives |
| `allowedDomains` | Accepted email domains. Empty means any |

Each provider then gets a button on the login page.

## How it works

Verdin uses the authorization code flow with PKCE (S256). The `state` is signed and tied
to a short-lived `HttpOnly` cookie. The `nonce` is derived from that state.

Verdin exchanges the code over TLS at the provider's token endpoint. It then checks the ID
token's issuer, audience (and `azp` when there are several), expiry and nonce. It needs
an `email` claim, and refuses it when `email_verified` is `false`.

Roles are only set when an account is created. After that, manage them in
**Settings → Users**.

Every sign-in is recorded in the audit logs as `admin.login`, with the provider. When a
sign-in fails, the browser goes back to the login page with the reason, and the reason is
also written to the server log.
