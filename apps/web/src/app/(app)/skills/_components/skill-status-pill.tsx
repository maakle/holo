import { Badge } from '@/components/ui/badge';

type Status = 'draft' | 'active' | 'archived';

export function SkillStatusPill({ status }: { status: Status }) {
  // Status colors map to DESIGN.md tokens. Active = success, archived = neutral,
  // draft = neutral with explicit label so it doesn't look like a styling miss.
  if (status === 'active') return <Badge variant="success">Active</Badge>;
  if (status === 'archived') return <Badge variant="neutral">Archived</Badge>;
  return <Badge variant="neutral">Draft</Badge>;
}
