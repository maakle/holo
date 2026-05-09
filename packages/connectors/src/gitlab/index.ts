export { createGitlabSpec } from './spec';
export type { GitlabSpecOptions } from './spec';

export { createGitlabApiClient } from './api';
export type {
  GitlabApiClient,
  GitlabUser,
  GitlabProject,
  GitlabMergeRequest,
  GitlabIssue,
  GitlabNote,
  GitlabRepoTreeEntry,
  GitlabBranch,
} from './api';

export { listAccessibleProjects } from './auth';

export { runGitlabProseSync } from './sync-prose';
export type {
  RunGitlabProseSyncInput,
  RunGitlabProseSyncOutput,
  GitlabProseChunkPayload,
  GitlabProseEmbedEnqueueFn,
} from './sync-prose';

export { runGitlabCodeSync } from './sync-code';
export type {
  RunGitlabCodeSyncInput,
  RunGitlabCodeSyncOutput,
  GitlabCodeChunkPayload,
  GitlabCodeEmbedEnqueueFn,
} from './sync-code';
