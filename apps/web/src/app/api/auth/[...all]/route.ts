import { toNextJsHandler } from 'better-auth/next-js';
import { getServerAuth } from '@/lib/server-context';

const handlerPromise = getServerAuth().then((auth) => toNextJsHandler(auth.handler));

export async function GET(req: Request) {
  return (await handlerPromise).GET(req);
}
export async function POST(req: Request) {
  return (await handlerPromise).POST(req);
}
