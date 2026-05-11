// Re-export barrel. The schema previously lived as a single 869-line file
// here; it has since been split into domain files (connectors, skills,
// observability, oauth, agent). This barrel preserves backwards-compat for
// any path-based imports (`@holo/db/.../schema/holo`).
export * from './connectors';
export * from './skills';
export * from './observability';
export * from './oauth';
export * from './agent';
