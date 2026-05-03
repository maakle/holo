export default function DashboardLoading() {
  return (
    <div className="space-y-10" aria-busy="true" aria-live="polite">
      <header className="flex flex-col gap-2">
        <span className="caption">Overview</span>
        <div className="h-9 w-64 animate-pulse rounded-md bg-surface-2" />
        <div className="h-5 w-full max-w-2xl animate-pulse rounded-md bg-surface-2" />
      </header>
      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-28 rounded-md border border-border bg-surface" />
        ))}
      </section>
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="h-72 rounded-md border border-border bg-surface lg:col-span-2" />
        <div className="h-72 rounded-md border border-border bg-surface" />
      </section>
    </div>
  );
}
