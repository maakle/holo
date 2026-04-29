export default function DashboardPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Overview</h1>
      <p className="text-sm text-gray-500">
        v0.0 Foundation. Substrate is wired; ingestion and retrieval land in subsequent specs.
        Visit{' '}
        <a className="underline" href="/connections">
          Connections
        </a>{' '}
        to connect GitHub.
      </p>
    </div>
  );
}
