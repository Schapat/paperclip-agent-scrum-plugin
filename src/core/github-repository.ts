/**
 * GitHub commit access for ticket evidence.
 *
 * Paperclip owns project workspace linkage. The plugin SDK exposes that
 * workspace metadata but no host-owned commit-diff client, so this module
 * performs only the optional, on-demand GitHub lookup for recorded commits.
 */

export interface GitHubRepository {
  owner: string;
  name: string;
  webUrl: string;
}

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

/** Fetches the file-level patch data for one recorded GitHub commit. */
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