/**
 * GitLab connector auth helpers.
 *
 * GitLab has no GitHub-App equivalent — we use a standard OAuth2
 * Application registered at https://gitlab.com/-/profile/applications.
 * The token exchange and refresh are handled by the framework's
 * `oauth2()` strategy in `spec.ts`; this module only owns helpers used
 * outside the per-resource sync, mirroring `github/auth.ts:listInstallationRepos`.
 */
import { createGitlabApiClient, type GitlabApiClient } from './api';

/**
 * Lists every project the OAuth-granted user can access at Reporter level
 * or above. Mirrors `listInstallationRepos` (GitHub) — used as the
 * fallback "everything I can see" set when no allowlist is configured.
 *
 * Returns `path_with_namespace` strings (e.g. `group/project`) for
 * symmetry with how GitHub uses `full_name`. The numeric project id is
 * preserved alongside via the project records when callers need to make
 * follow-up REST calls (most GitLab endpoints take the id, not the path).
 */
export async function listAccessibleProjects(args: {
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<Array<{ id: number; pathWithNamespace: string; defaultBranch: string | null }>> {
  const client: GitlabApiClient = createGitlabApiClient(
    args.token,
    args.fetchImpl ?? fetch,
  );
  const projects = await client.listAccessibleProjects();
  return projects.map((p) => ({
    id: p.id,
    pathWithNamespace: p.path_with_namespace,
    defaultBranch: p.default_branch,
  }));
}
