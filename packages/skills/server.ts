// Root-level proxy so classic `moduleResolution: "Node"` consumers (e.g. the
// worker) resolve `@holo/skills/server` as `<pkg>/server.ts`. Bundler/node16
// consumers read `exports["./server"]` in package.json and land in the same
// place.
export * from './src/server';
