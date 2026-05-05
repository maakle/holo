// Skill runs UI is deferred with the rest of the skills surface. See README roadmap.

export default function SkillRunsDeferredPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <span className="caption">Roadmap</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">
          Skill runs are on the roadmap
        </h1>
      </div>
      <p className="max-w-2xl text-[15px] leading-6 text-text-muted">
        Skill execution + observability is parked alongside skills themselves. Use the
        Observability page for general agent call traces in the meantime.
      </p>
    </div>
  );
}
