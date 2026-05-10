import { toNextJsHandler } from 'better-auth/next-js';
import { getServerAuth } from '@/lib/server-context';

export const dynamic = 'force-dynamic';

let cached: ReturnType<typeof toNextJsHandler> | null = null;
async function getHandler() {
  if (cached) return cached;
  const auth = await getServerAuth();
  cached = toNextJsHandler(auth.handler);
  return cached;
}

export async function GET(req: Request) {
  return (await getHandler()).GET(req);
}
export async function POST(req: Request) {
  return (await getHandler()).POST(req);
}
