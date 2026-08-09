import { describe, expect, it, vi } from 'vitest';

import { parseGitHubRepositoryUrl, validateGitHubRepository } from '../github-repository';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GitHub repository validation', () => {
  it('parses HTTPS and SSH GitHub repository URLs', () => {
    expect(parseGitHubRepositoryUrl('https://github.com/acme/customer-portal.git')).toEqual({
      owner: 'acme',
      name: 'customer-portal',
      webUrl: 'https://github.com/acme/customer-portal',
    });
    expect(parseGitHubRepositoryUrl('git@github.com:acme/customer-portal.git')).toEqual({
      owner: 'acme',
      name: 'customer-portal',
      webUrl: 'https://github.com/acme/customer-portal',
    });
  });

  it('accepts a reachable repository with a successful latest GitHub Actions run', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/repos/acme/customer-portal')) {
        return jsonResponse({ full_name: 'acme/customer-portal', html_url: 'https://github.com/acme/customer-portal' });
      }
      if (url.endsWith('/repos/acme/customer-portal/actions/workflows?per_page=1')) {
        return jsonResponse({ total_count: 1 });
      }
      if (url.endsWith('/repos/acme/customer-portal/actions/runs?per_page=1')) {
        return jsonResponse({
          workflow_runs: [{
            id: 7,
            name: 'CI',
            status: 'completed',
            conclusion: 'success',
            html_url: 'https://github.com/acme/customer-portal/actions/runs/7',
            updated_at: '2026-08-09T12:00:00.000Z',
          }],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      validateGitHubRepository('https://github.com/acme/customer-portal.git', { fetch: fetchMock })
    ).resolves.toEqual({
      valid: true,
      repository: {
        owner: 'acme',
        name: 'customer-portal',
        webUrl: 'https://github.com/acme/customer-portal',
      },
      pipeline: {
        name: 'CI',
        url: 'https://github.com/acme/customer-portal/actions/runs/7',
        updatedAt: '2026-08-09T12:00:00.000Z',
      },
    });
  });

  it('rejects a reachable repository without a successful pipeline run', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/repos/acme/customer-portal')) return jsonResponse({});
      if (url.endsWith('/repos/acme/customer-portal/actions/workflows?per_page=1')) {
        return jsonResponse({ total_count: 1 });
      }
      return jsonResponse({ workflow_runs: [{ status: 'in_progress', conclusion: null }] });
    });

    await expect(
      validateGitHubRepository('https://github.com/acme/customer-portal', { fetch: fetchMock })
    ).resolves.toEqual({
      valid: false,
      error: 'The latest GitHub Actions run has not completed successfully.',
    });
  });
});