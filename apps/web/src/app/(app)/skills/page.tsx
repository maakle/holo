// Skills (manual labeling, synthesis, marketplace) is deferred from the MVP.
// See README roadmap. Original implementation preserved in git history;
// the supporting code is still in packages/skills/, packages/discovery/, and
// apps/web/src/lib/synthesize-and-persist.ts so we can re-enable later
// without a re-architecture.

export default function SkillsDeferredPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <span className="caption">Roadmap</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">
          Skills are on the roadmap
        </h1>
      </div>
      <p className="max-w-2xl text-[15px] leading-6 text-text-muted">
        Auto-discovering procedures from your team&apos;s artifacts is parked while we
        focus on the MVP: connectors + MCP/OpenAPI + bring-your-own-agent. The
        substrate, schema, and discovery package are already in the repo and will
        be reactivated post-launch.
      </p>
    </div>
  );
}
