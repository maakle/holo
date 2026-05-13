export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-3xl space-y-8">
      <header className="flex flex-col gap-2">
        <span className="caption">Workspace</span>
        <h1 className="font-display text-h1 font-semibold tracking-tight">Settings</h1>
        <p className="text-[15px] leading-6 text-text-muted">
          Manage your workspace. Destructive actions live in the Danger Zone below.
        </p>
      </header>

      <div>{children}</div>
    </div>
  );
}
