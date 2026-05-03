import { z } from 'zod';

export const ROLES = ['owner', 'admin', 'member'] as const;
export type Role = (typeof ROLES)[number];

export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  role: z.enum(ROLES, { message: 'Invalid role.' }),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const cancelInvitationSchema = z.object({
  invitationId: z.string().min(1),
});
export type CancelInvitationInput = z.infer<typeof cancelInvitationSchema>;
