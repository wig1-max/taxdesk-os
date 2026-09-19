# TaxDesk OS — Backup, restore & production safety

Real client data (including encrypted PAN and uploaded documents) lives in
the hosted project. Treat backups as mandatory, not optional. This runbook
is deliberately manual and simple — no fragile custom automation.

## ⚠️ Production safety rules

- **Never run `supabase db reset` against production or any shared project.**
  It DROPS and recreates the database. It is for local/staging only.
- **Never run `supabase/seed.sql` in production** — it inserts synthetic demo
  clients/cases.
- **Never hand-run `GRANT`/`REVOKE`** — privileges live in migrations.
- **Guard `PAN_ENCRYPTION_KEY`.** If it is lost, stored PANs cannot be
  decrypted; if it is rotated, existing ciphertext must be re-encrypted.
  Back it up in your password manager, separately from database backups.
- Do all destructive work against **staging** first.

## What must be backed up

There are two independent stores — back up **both**, ideally at the same time:

1. **Postgres database** — all rows (clients, cases, audit log, encrypted PAN
   column, etc.).
2. **Storage buckets** — the private `case-files` and `generated-pdfs`
   buckets (the actual uploaded documents / generated PDFs). A database backup
   does **not** include these files.

## Database backups

Managed Supabase includes automated daily backups (and PITR on higher tiers)
— confirm they are enabled for the production project and note the retention.
In addition, take your own logical dump before every deploy and on a schedule:

```bash
# Full logical backup (schema + data), timestamped
pg_dump "$PROD_DB_URL" -Fc -f "taxdesk-$(date +%Y%m%d-%H%M).dump"

# Or via the CLI against the linked project
supabase db dump --linked -f "taxdesk-$(date +%Y%m%d-%H%M).sql"
```

Store dumps encrypted, off the app host (e.g. an access-controlled bucket).
They contain the encrypted PAN column — protect them like production data.

## Storage / document backups

Mirror the private buckets to a secure location using the S3-compatible
endpoint (credentials from `supabase status` locally, or the project's
storage settings when hosted):

```bash
# Example with the AWS CLI pointed at Supabase Storage S3
aws s3 sync s3://case-files      ./backup/case-files      --endpoint-url "$SUPABASE_S3_URL"
aws s3 sync s3://generated-pdfs  ./backup/generated-pdfs  --endpoint-url "$SUPABASE_S3_URL"
```

Keep storage backups on the same cadence as database backups so the two stay
roughly consistent.

## Before-deploy backup checklist

1. Database dump taken and its size looks sane (not truncated).
2. Storage buckets synced.
3. `PAN_ENCRYPTION_KEY` for this environment is safely recorded.
4. Confirmed you are pointed at the intended project (`supabase projects list`,
   check `APP_BASE_URL`).
5. Only then run `supabase db push` and deploy.

## Restore checklist

Rehearse this on **staging** at least once before you need it for real.

1. Stop writes if possible (put the app in maintenance / take it offline).
2. Restore the database:
   ```bash
   pg_restore --clean --if-exists -d "$TARGET_DB_URL" taxdesk-YYYYMMDD-HHMM.dump
   # or: psql "$TARGET_DB_URL" -f taxdesk-YYYYMMDD-HHMM.sql
   ```
3. Restore storage by syncing the backup back into the buckets:
   ```bash
   aws s3 sync ./backup/case-files      s3://case-files      --endpoint-url "$SUPABASE_S3_URL"
   aws s3 sync ./backup/generated-pdfs  s3://generated-pdfs  --endpoint-url "$SUPABASE_S3_URL"
   ```
4. Ensure the environment's `PAN_ENCRYPTION_KEY` matches the one in force when
   the data was written, or PAN reveal will fail.
5. Verify: sign in, open a client, confirm masked PAN shows, reveal one PAN
   (checks the key), open a case document (checks storage), read the audit log.
6. Re-enable writes.

## Local reset & bootstrap (dev only)

For local development, a full reset is expected and safe:

```bash
supabase db reset       # drops, re-applies all migrations, runs seed.sql (demo clients)
```

Then bootstrap the first admin and demo cases — see `supabase/README.md`
("Bootstrap the first admin"). This flow must never be used on production.
