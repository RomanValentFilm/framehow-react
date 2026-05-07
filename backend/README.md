# Framehow Backend

Cloudflare Workers + D1 backend for Framehow accounts and sync. Spec lives in
`../ACCOUNT_SYNC_SPEC.md`.

## Stack

- **Workers** (Hono router, TypeScript)
- **D1** (SQLite) — `framehow-db` (id `9a805ca2-576c-4c8c-8af4-71016b8711b5`)
- **R2** — `framehow-images` bucket. **Not yet activated.** The binding in
  `wrangler.toml` is commented out; uncomment once R2 is enabled on the
  Cloudflare account and the bucket is created.

## First-time setup

```bash
cd backend
npm install

# Apply the schema to the local D1 (used by `wrangler dev`)
npm run db:migrate:local

# Apply the schema to the remote D1 (production)
npm run db:migrate:remote
```

## Running locally

```bash
npm run dev   # http://localhost:8787
```

While `EMAIL_API_KEY` is unset, signup/forgot-password log instead of sending
mail and the relevant token is echoed back in the response as `dev_token` so
you can complete verification / reset by hand.

## Secrets

Set with `wrangler secret put <NAME>`:

| Secret            | Purpose                                      |
| ----------------- | -------------------------------------------- |
| `EMAIL_API_KEY`   | Resend / MailChannels / SendGrid API key     |
| `EMAIL_FROM`      | Verified sender address                      |
| `ADMIN_API_TOKEN` | Bearer token for `/admin/*` (storage alerts) |

For local dev, put them in `backend/.dev.vars` (gitignored):

```
EMAIL_API_KEY=re_...
EMAIL_FROM=hello@framehow.app
ADMIN_API_TOKEN=...
```

## Endpoints

```
GET    /                       — service banner
GET    /healthz                — liveness

POST   /auth/signup
POST   /auth/login
POST   /auth/logout
POST   /auth/forgot-password
POST   /auth/reset-password
GET    /auth/verify-email?token=...

GET    /user/me                — current profile
PUT    /user/me                — update name / profession
PUT    /user/password          — change password (requires current)
DELETE /user/me                — GDPR account delete (soft)

GET    /projects               — list user's active projects
POST   /projects               — create
GET    /projects/:id           — full tree (strips → frames → versions → images, drawings)
PUT    /projects/:id           — rename
DELETE /projects/:id           — soft delete (10-day purge by cron, TODO)

GET    /projects/:id/sync      — download cloud state
POST   /projects/:id/sync      — upload local state (project-level LWW)

POST   /upload                 — upload image to R2 (returns r2_key)
GET    /images/<r2_key>        — serve image (owner only)
```

`/admin/*` and the cron purger are still TODO — see the spec.

## Sync model

`POST /projects/:id/sync` accepts the entire project tree and replaces the
server's children atomically when `payload.project.updated_at >= server.updated_at`.
If the server is newer, the response is `409 conflict: true` with the server's
tree, so the client can reconcile and retry.

This is the spec's "last write wins" applied at the project level —
appropriate for the single-user beta. Revisit before collaboration ships.

## Storage limits (beta)

- 10 MB per image — enforced at `/upload`.
- 350 MB per account — enforced at `/projects/:id/sync` (sums `images.size_bytes`
  across the user's other active projects, plus the incoming payload).
- 400 uploads/hour — not yet enforced (TODO; cheap to add via a count of recent
  `images.created_at` rows once usage warrants).

## Activating R2 later

1. Add a payment method on Cloudflare and enable R2.
2. `wrangler r2 bucket create framehow-images`
3. Uncomment the `[[r2_buckets]]` block in `wrangler.toml`.
4. `npm run deploy`

The upload handler will reference `env.IMAGES_BUCKET`, which is typed as
optional in `src/types.ts` so the rest of the API keeps building until then.

## Notes on schema deviations

- `users` carries two extra columns (`email_verification_token_hash`,
  `email_verification_expires_at`) so we don't need a separate
  `email_verifications` table to support the `/auth/verify-email` flow.
- `sessions` and `password_resets` store `token_hash` (SHA-256) rather than the
  raw token, so a DB leak doesn't grant live access.
- `users.deleted_at` is added for the GDPR delete-account flow described in the
  spec (soft-delete + 10-day purge).
