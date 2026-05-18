'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { SidebarBody, type SidebarProps } from '@/components/app-sidebar';

/**
 * Hamburger trigger + slide-out drawer that re-uses the desktop sidebar
 * body verbatim. Only rendered on viewports below the `lg` breakpoint —
 * the static `<aside>` takes over from `lg:` and up.
 *
 * The drawer auto-closes on route change so navigating from a nav item
 * doesn't leave a half-visible drawer over the destination page.
 */
export function MobileNav(props: SidebarProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="Open navigation"
        className="lg:hidden inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text focus:outline-none focus:focus-ring"
      >
        <Menu className="h-5 w-5" aria-hidden />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-[280px] max-w-[85vw] bg-bg p-0"
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="flex h-full flex-col">
          <SidebarBody {...props} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
