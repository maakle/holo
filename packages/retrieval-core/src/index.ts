// apps/api and apps/mcp must access @holo/db only via this package (ESLint boundary rule).
export { hybridSearch } from './search';
export type { SearchOptions, SearchHit } from './search';
