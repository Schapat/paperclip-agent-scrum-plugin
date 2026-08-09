import { describe, expect, it } from 'vitest';

import { parseGitHubRepositoryUrl } from '../github-repository';

describe('GitHub repository helpers', () => {
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
    expect(parseGitHubRepositoryUrl('https://gitlab.com/acme/customer-portal')).toBeNull();
  });
});