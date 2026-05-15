export type SubjectSource = 'slack' | 'teams';

export interface UserSubject {
  subject: string;
  source: SubjectSource;
}

export interface ReplaceSubjectsInput {
  userId: string;
  organizationId: string;
  source: SubjectSource;
  subjects: string[];
}
