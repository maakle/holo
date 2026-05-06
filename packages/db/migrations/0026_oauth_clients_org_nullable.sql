-- Open dynamic client registration (RFC 7591): a client can be registered
-- without an authenticated session (e.g. Claude / Cursor self-registering at
-- "Connect" time). The user + org binding happens later at the consent step
-- and is recorded per-grant on oauth_auth_codes / oauth_access_tokens — those
-- columns remain NOT NULL. Only the client row itself becomes org-less until
-- (and unless) someone authorizes it.
ALTER TABLE "oauth_clients" ALTER COLUMN "organization_id" DROP NOT NULL;
