// Nightly procedure discovery cron deferred from the MVP. See README roadmap.
// vercel.json's cron entry is also commented; nothing schedules this today.
import { deferred } from '@/lib/feature-deferred';

export const GET = () => deferred('procedure discovery cron');
