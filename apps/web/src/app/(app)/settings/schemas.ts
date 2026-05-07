import { z } from 'zod';

export const deleteWorkspaceSchema = z.object({
  organizationId: z.string().uuid({ message: 'Invalid workspace id.' }),
  confirmName: z.string().min(1, 'Type the workspace name to confirm.'),
});
export type DeleteWorkspaceInput = z.infer<typeof deleteWorkspaceSchema>;
