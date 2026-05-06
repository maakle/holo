import Image from 'next/image';
import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <Image
      src="/logo.png"
      alt="holo"
      width={64}
      height={64}
      priority
      className={cn('h-full w-full object-contain dark:invert', className)}
    />
  );
}

export function HoloLogo({
  className,
  logoClassName,
  wordmarkClassName,
}: {
  className?: string;
  logoClassName?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className={cn('inline-block h-5 w-5', logoClassName)}>
        <Logo />
      </span>
      <span
        className={cn(
          'font-display text-[15px] font-semibold tracking-tight leading-none',
          wordmarkClassName,
        )}
      >
        holo
      </span>
    </span>
  );
}
