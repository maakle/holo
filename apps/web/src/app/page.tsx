import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getServerAuth } from '@/lib/server-context';

export default async function Home() {
  const auth = await getServerAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect('/dashboard');
  redirect('/sign-in');
}
