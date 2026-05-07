import { z } from 'zod';

export const deleteWorkspaceSchema = z.object({
  organizationId: z.string().uuid({ message: 'Invalid workspace id.' }),
  confirmName: z.string().min(1, 'Type the workspace name to confirm.'),
});
export type DeleteWorkspaceInput = z.infer<typeof deleteWorkspaceSchema>;

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required.')
  .max(64, 'Name must be 64 characters or fewer.');

export const workspaceSlugSchema = z
  .string()
  .trim()
  .min(1, 'Slug is required.')
  .max(48, 'Slug must be 48 characters or fewer.')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Slug must be lowercase letters, numbers, and hyphens only.',
  );

export const updateWorkspaceSchema = z.object({
  organizationId: z.string().uuid({ message: 'Invalid workspace id.' }),
  field: z.enum(['name', 'slug']),
  value: z.string(),
});
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
