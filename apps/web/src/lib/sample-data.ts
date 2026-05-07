import 'server-only';

// Single source of truth lives in @holo/db so the migration seeder and the
// runtime API can share it. This file is a thin re-export so web callers can
// import without reaching across packages directly.
export {
  ensureSampleData,
  getSampleDataStatus,
  removeSampleData,
  SAMPLE_PROVIDER,
  SAMPLE_SOURCE_NAME,
  SAMPLE_SOURCE_EXTERNAL_ID,
  SAMPLE_DATA_DESCRIPTION,
  type SampleDataStatus,
} from '@holo/db';
