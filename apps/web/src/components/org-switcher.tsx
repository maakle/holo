export function OrgSwitcher({ name = 'holo' }: { name?: string }) {
  return (
    <div className="flex w-full items-center gap-2 px-2 py-2">
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-text"
        aria-hidden
      >
        <span className="font-display text-[14px] font-semibold leading-none text-bg">
          {name.charAt(0).toLowerCase()}
        </span>
      </div>
      <span className="min-w-0 flex-1 truncate font-display text-[14px] font-semibold tracking-tight">
        {name}
      </span>
    </div>
  );
}
