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

export const removeMemberSchema = z.object({
  memberId: z.string().min(1),
});
export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;

// 32-byte base64url-encoded random ⇒ 43 chars. Allow 32–128 to be defensive
// against future format changes.
export const joinViaInviteLinkSchema = z.object({
  token: z.string().min(32).max(128),
});
export type JoinViaInviteLinkInput = z.infer<typeof joinViaInviteLinkSchema>;
