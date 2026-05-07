-- Per-run, per-kind breakdown of what the chunk pipeline did. Phase 1 of the
-- richer sync history view modeled on Kombo's "Synchronized models" table:
-- each completed run records how many chunks were newly inserted vs. dropped
-- as duplicates of content the index already had, grouped by chunk kind.
--
-- Shape: { [kind]: { new: integer, deduped: integer } }
--
-- Older rows (pre-0028) keep `breakdown = NULL`; the dashboard renders "—"
-- for those instead of misleading zeros. `artifact_count` stays as the
-- redundant total of `new` counts across kinds for back-compat with the
-- existing UI summary.
--
-- "Changed" (chunk supersession) is intentionally not modeled yet — Holo's
-- chunks table doesn't retire old chunks when source content changes, so
-- "changed" would conflate with "new" and produce a misleading column.
-- Revisit if/when chunk supersession lands.

ALTER TABLE "sync_runs"
  ADD COLUMN IF NOT EXISTS "breakdown" jsonb;
