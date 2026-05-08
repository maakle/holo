-- better-auth's organization plugin requires `createdAt` on the invitation
-- table. Older rows get NOW() — acceptable since invitations are short-lived
-- (default 48h expiry) and createdAt is informational, not load-bearing.

ALTER TABLE "invitation"
  ADD COLUMN IF NOT EXISTS "created_at" timestamptz NOT NULL DEFAULT now();
