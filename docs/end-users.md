# End users

End users are the people who sign in to your site or app. Admins, who use the admin panel, are separate. This works like Strapi's users-permissions plugin and uses the same routes.

To use it:

1. Turn it on in **Settings → Features → End users**. It is off by default.
2. Manage accounts, roles and settings in **Settings → End users** (permission `endusers.manage`).

## Roles

- **Public** covers requests without a token. Its permissions are the ones in **Settings → Public access**.
- **Authenticated** is given to new accounts. You can pick another default role in the settings.
- **Custom roles** hold any set of permissions. A role's permissions use the same matrix as public access and API tokens: find, findOne, create, update, delete, publish and readDrafts on each content type and on the media library.

To act with a user's role, send the user's JWT as `Authorization: Bearer <jwt>`. API tokens start with `vd_`, so Verdin can tell the two apart.

## API

The routes live under the content API prefix, `/api` by default. The request and response shapes follow Strapi v5.

| Route | |
|---|---|
| `POST /auth/local/register` | `{ username, email, password }` → `{ jwt, user }`, or `{ user }` when email confirmation is on |
| `POST /auth/local` | `{ identifier (email or username), password }` → `{ jwt, user }` |
| `GET /auth/email-confirmation?confirmation=` | Confirms the email, then redirects to the setting's URL or returns the user |
| `POST /auth/send-email-confirmation` | `{ email }`: sends a new confirmation link |
| `POST /auth/forgot-password` | `{ email }`: emails `resetPasswordUrl?code=…` (valid one hour). The answer is the same whether or not the account exists |
| `POST /auth/reset-password` | `{ code, password, passwordConfirmation }` → `{ jwt, user }` |
| `POST /auth/change-password` | Signed in; `{ currentPassword, password, passwordConfirmation }` → `{ jwt, user }` |
| `GET /users/me` | The signed-in user |
| `GET /connect/{provider}` | Starts an OAuth sign-in |
| `GET /auth/{provider}/callback?access_token=` | Exchanges the provider's token for `{ jwt, user }` |

- **Tokens.** JWTs last `jwtExpiresInDays` (30 by default). Changing or resetting a password revokes the user's earlier tokens, and so does blocking the user.
- **Rate limit.** Sign-in, registration and reset requests are limited to 20 per minute and IP.
- **Passwords.** They are stored with Argon2id. Accounts imported from Strapi keep their bcrypt hash until their next sign-in, when it is re-hashed.

## OAuth

Built-in presets exist for `github` and `google`. Any other provider name is a generic OAuth 2 provider and needs `authorizeUrl`, `tokenUrl` and `userInfoUrl`.

1. In the provider's console, register the callback URL `https://<your server>/api/connect/<provider>/callback`. Set `[server].public_url` so that Verdin knows its public URL.
2. Put the client id and your frontend's redirect URI in the provider's settings.
3. Put the client secret in the environment as `VERDIN_OAUTH_<PROVIDER>_SECRET` (for example `VERDIN_OAUTH_GITHUB_SECRET`). Secrets are never stored in the database.

The sign-in follows Strapi's flow:

1. The browser opens `/api/connect/github`.
2. The provider sends it back to Verdin.
3. Verdin redirects to your `redirectUri?access_token=<provider token>`.
4. Your frontend calls `/api/auth/github/callback?access_token=…` and gets a Verdin JWT.

The OAuth state is signed and bound to the browser with a cookie. Accounts are matched by email. An email already used by another provider is refused.

## Email

Confirmation and password reset emails go through `[email]`:

```toml
[email]
provider = "smtp"          # log (default: messages are only written to the log), smtp, resend, postmark
from = "My site <no-reply@example.com>"
reply_to = "help@example.com"

[email.smtp]
host = "smtp.example.com"
port = 587
username = "apikey"
security = "starttls"      # tls (implicit, port 465) or none
```

Secrets come from the environment only:

- `VERDIN_EMAIL_SMTP_PASSWORD` for SMTP
- `VERDIN_EMAIL_API_KEY` for Resend and Postmark

**Settings → Features → Email** sends a test message. The subject and text of each email are templates with `{{username}}`, `{{email}}` and `{{url}}`, edited in **Settings → End users**.

The development compose file (`docker/compose.dev.yml`) includes Mailpit, an SMTP server on :1025 with an inbox at http://localhost:8025.

## Importing from Strapi

`verdin import strapi` also brings over:

- end users and their passwords
- custom roles
- the permissions of the public, authenticated and custom roles
