-- Drop the unused `customer_number` column from google_chat_workspaces.
-- Was display-only metadata after the routing rework; nobody reads it.

ALTER TABLE "google_chat_workspaces" DROP COLUMN IF EXISTS "customer_number";
