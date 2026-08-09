/**
 * GitHub repository access for project onboarding and ticket evidence.
 *
 * The plugin SDK exposes workspace metadata but deliberately no Git client.
 * This module keeps the public GitHub API details and authentication policy in
 * one place so workflow code only handles repository and commit results.
 */

export interface GitHubRepository {
  owner: string;
  name: string;
  webUrl: string;
}

export interface GitHubPipeline {
  name: string;
  url: string;
  updatedAt: string;
}

export type GitHubRepositoryValidation =
  | { valid: true; repository: GitHubRepository; pipeline: GitHubPipeline }
  | { valid: false; error: string };

export interface GitHubCommitFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export type GitHubCommitChangesResult =
  | {
      valid: true;
      sha: string;
      url: string;
      message: string;
      authoredAt: string | null;
      files: GitHubCommitFile[];
    }
  | { valid: false; error: string };

export interface GitHubRequestOptions {
  token?: string | null;
  apiBaseUrl?: string | null;
  fetch?: typeof fetch;
}

const GITHUB_WEB_HOST = 'github.com';
const DEFAULT_GITHUB_API_BASE_URL = 'https://api.github.com';

/** Parses canonical HTTPS and SSH GitHub URLs into stable repository coordinates. */
export function parseGitHubRepositoryUrl(repoUrl: string | null | undefined): GitHubRepository | null {
  const value = repoUrl?.trim();
  if (!value) return null;

  const sshMatch = value.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (sshMatch) return repositoryFromParts(sshMatch[1], sshMatch[2]);

  try {
    const parsed = new URL(value);
    if (parsed.hostname.toLowerCase() !== GITHUB_WEB_HOST) return null;
    const [owner, name, ...rest] = parsed.pathname.split('/').filter(Boolean);
    if (!owner || !name || rest.length > 0) return null;
    return repositoryFromParts(owner, name);
  } catch {
    return null;
  }
}

/** Ensures a GitHub repository is visible and its newest Actions run passed. */
export async function validateGitHubRepository(
  repoUrl: string | null | undefined,
  options: GitHubRequestOptions = {}
): Promise<GitHubRepositoryValidation> {
  const repository = parseGitHubRepositoryUrl(repoUrl);
  if (!repository) {
    return { valid: false, error: 'The project workspace is not linked to a supported GitHub repository.' };
  }

  const request = requestFor(options);
  const repositoryPath = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;

  try {
    const repositoryResponse = await request(repositoryPath);
    if (!repositoryResponse.ok) {
      return { valid: false, error: repositoryError(repositoryResponse.status) };
    }

    const workflowsResponse = await request(`${repositoryPath}/actions/workflows?per_page=1`);
    if (!workflowsResponse.ok) {
      return { valid: false, error: `GitHub Actions workflows could not be inspected (HTTP ${workflowsResponse.status}).` };
    }
    const workflows = await jsonRecord(workflowsResponse);
    if (Number(workflows?.total_count ?? 0) < 1) {
      return { valid: false, error: 'The GitHub repository has no GitHub Actions workflow.' };
    }

    const runsResponse = await request(`${repositoryPath}/actions/runs?per_page=1`);
    if (!runsResponse.ok) {
      return { valid: false, error: `The latest GitHub Actions run could not be inspected (HTTP ${runsResponse.status}).` };
    }
    const runs = await jsonRecord(runsResponse);
    const latestRun = Array.isArray(runs?.workflow_runs) ? runs.workflow_runs[0] : null;
    if (!isRecord(latestRun) || latestRun.status !== 'completed' || latestRun.conclusion !== 'success') {
      return { valid: false, error: 'The latest GitHub Actions run has not completed successfully.' };
    }

    const name = text(latestRun.name) ?? 'GitHub Actions';
    const url = text(latestRun.html_url);
    const updatedAt = text(latestRun.updated_at);
    if (!url || !updatedAt) {
      return { valid: false, error: 'The latest GitHub Actions run does not expose a verifiable result.' };
    }

    return {
      valid: true,
      repository,
      pipeline: { name, url, updatedAt },
    };
  } catch (error) {
    return {
      valid: false,
      error: `GitHub repository validation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Fetches the file-level patch data for one commit in a verified GitHub repository. */
export async function fetchGitHubCommitChanges(
  repository: GitHubRepository,
  sha: string,
  options: GitHubRequestOptions = {}
): Promise<GitHubCommitChangesResult> {
  const normalizedSha = sha.trim();
  if (!/^[0-9a-f]{7,64}$/i.test(normalizedSha)) {
    return { valid: false, error: 'The commit SHA is not valid.' };
  }

  try {
    const response = await requestFor(options)(
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/commits/${encodeURIComponent(normalizedSha)}`
    );
    if (!response.ok) {
      return { valid: false, error: `GitHub could not load commit ${normalizedSha} (HTTP ${response.status}).` };
    }

    const payload = await jsonRecord(response);
    const commit = isRecord(payload?.commit) ? payload.commit : null;
    const message = text(commit?.message) ?? `Commit ${normalizedSha.slice(0, 7)}`;
    const url = text(payload?.html_url) ?? `${repository.webUrl}/commit/${normalizedSha}`;
    const authoredAt = text(isRecord(commit?.author) ? commit.author.date : null);
    const files = Array.isArray(payload?.files)
      ? payload.files.flatMap((file) => toCommitFile(file))
      : [];

    return {
      valid: true,
      sha: text(payload?.sha) ?? normalizedSha,
      url,
      message,
      authoredAt,
      files,
    };
  } catch (error) {
    return {
      valid: false,
      error: `GitHub commit lookup failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function repositoryFromParts(owner: string, rawName: string): GitHubRepository | null {
  const name = rawName.replace(/\.git$/i, '');
  if (!owner || !name) return null;
  return { owner, name, webUrl: `https://${GITHUB_WEB_HOST}/${owner}/${name}` };
}

function requestFor(options: GitHubRequestOptions): (path: string) => Promise<Response> {
  const fetchImpl = options.fetch ?? fetch;
  const baseUrl = (options.apiBaseUrl?.trim() || DEFAULT_GITHUB_API_BASE_URL).replace(/\/+$/, '');
  const token = options.token?.trim();
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  if (token) headers.authorization = `Bearer ${token}`;

  return (path) => fetchImpl(`${baseUrl}${path}`, { headers });
}

function repositoryError(status: number): string {
  if (status === 401 || status === 403 || status === 404) {
    return 'The GitHub repository is not reachable. Configure a GitHub token for private repositories.';
  }
  return `The GitHub repository is not reachable (HTTP ${status}).`;
}

async function jsonRecord(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value = await response.json() as unknown;
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function toCommitFile(value: unknown): GitHubCommitFile[] {
  if (!isRecord(value)) return [];
  const path = text(value.filename);
  if (!path) return [];

  return [{
    path,
    status: text(value.status) ?? 'modified',
    additions: number(value.additions),
    deletions: number(value.deletions),
    patch: text(value.patch),
  }];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function number(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}