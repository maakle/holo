-- RFC 7591 dynamic client registration is unauthenticated, so anyone can
-- POST /api/oauth/register with `client_name: "GitHub"` and an
-- attacker-controlled redirect URI. The consent page now renders a
-- prominent "Unverified app" warning when this flag is false — users see
-- the actual redirect host and the unverified status before approving.
-- Flip to true out-of-band (manual SQL or admin UI) once a client is
-- confirmed legitimate. Default false for new and existing rows.
ALTER TABLE "oauth_clients" ADD COLUMN "is_verified" boolean DEFAULT false NOT NULL;