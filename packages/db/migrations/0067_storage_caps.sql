-- Storage caps per plan (billing PR 3).
--
-- Adds `maxStoredArtifacts` to each plan's `features` JSONB. Pure data
-- migration: the column shape was already JSONB; only the documented sub-key
-- is new. Null = unlimited; we set it explicitly for Enterprise so the
-- gate's `?? null` works uniformly.
--
-- Caps were chosen so the storage limit gates a customer at roughly the same
-- tier as the credit grant does (Free → Starter → Team → Business across
-- both meters).

UPDATE billing_plans
SET features = features || jsonb_build_object('maxStoredArtifacts', 10000)
WHERE slug = 'free';

UPDATE billing_plans
SET features = features || jsonb_build_object('maxStoredArtifacts', 100000)
WHERE slug = 'starter';

UPDATE billing_plans
SET features = features || jsonb_build_object('maxStoredArtifacts', 1000000)
WHERE slug = 'team';

UPDATE billing_plans
SET features = features || jsonb_build_object('maxStoredArtifacts', 10000000)
WHERE slug = 'business';

UPDATE billing_plans
SET features = features || jsonb_build_object('maxStoredArtifacts', null)
WHERE slug = 'enterprise';
