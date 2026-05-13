import { redirect } from 'next/navigation';

export default async function AuditPageRedirect({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const qs = params.page ? `?page=${encodeURIComponent(params.page)}` : '';
  redirect(`/settings/audit-log${qs}`);
}
