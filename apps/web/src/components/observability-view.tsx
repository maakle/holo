// Re-export shim so any external imports of `@/components/observability-view`
// continue to resolve after the split. New code should import from
// `@/components/observability`.
export { ObservabilityView } from './observability';
export type { EventRow } from './observability';
