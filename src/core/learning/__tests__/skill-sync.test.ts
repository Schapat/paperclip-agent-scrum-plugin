/**
 * Tests für den Abgleich mit der Paperclip-Skill-Bibliothek
 *
 * Kritischer Punkt: `syncAgentSkills` erwartet den vollständigen Sollzustand.
 * Wer nur die eigenen Skills sendet, wählt fremde Zuweisungen ab.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentSkill } from '../../types';
import {
  assignSkillsToAgent,
  ensureLibrarySkills,
  toSkillMarkdown,
  toSkillSlug,
  type SkillSyncClient,
} from '../skill-sync';

function skill(overrides: Partial<AgentSkill> = {}): AgentSkill {
  return {
    id: 'skill-1',
    name: 'Fehlerfälle testen',
    description: 'Vor der Übergabe ins Review Fehlerbehandlung prüfen',
    category: 'quality',
    roles: ['developer'],
    active: true,
    learningIds: ['l-1'],
    reinforcementCount: 2,
    createdAt: '2026-08-01T00:00:00.000Z',
    activatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Client-Attrappe mit In-Memory-Bibliothek. */
function createClient(
  library: Array<{ id: string; key: string; slug: string; name: string }> = [],
  agentEntries: Array<{ key: string; desired: boolean }> = []
) {
  const synced: string[][] = [];
  const client: SkillSyncClient = {
    listCompanySkills: vi.fn(async () => library),
    createCompanySkill: vi.fn(async (companyId, params) => {
      const entry = {
        id: `id-${params.slug}`,
        key: `company/${companyId}/${params.slug}`,
        slug: params.slug!,
        name: params.name,
      };
      library.push(entry);
      return entry;
    }),
    listAgentSkills: vi.fn(async () => ({ entries: agentEntries })),
    syncAgentSkills: vi.fn(async (_a, desired) => {
      synced.push(desired);
      return {};
    }),
  };
  return { client, synced, library };
}

describe('toSkillSlug', () => {
  it('erzeugt einen stabilen, URL-tauglichen Slug', () => {
    expect(toSkillSlug(skill())).toBe('agent-scrum-learning-skill-1');
  });

  it('trennt gleichnamige lokale Skills voneinander', () => {
    expect(toSkillSlug(skill({ id: 'skill-a' }))).not.toBe(toSkillSlug(skill({ id: 'skill-b' })));
  });

  it('behandelt Sonderzeichen in einer Skill-ID', () => {
    expect(toSkillSlug(skill({ id: 'Größe & Maß: prüfen!' }))).toBe('agent-scrum-learning-groesse-mass-pruefen');
  });

  it('liefert einen reservierten Fallback für eine unbrauchbare ID', () => {
    expect(toSkillSlug(skill({ id: '!!!' }))).toBe('agent-scrum-learning-unknown');
  });
});

describe('toSkillMarkdown', () => {
  it('dokumentiert Herkunft und Belastbarkeit', () => {
    const md = toSkillMarkdown(skill());
    expect(md).toContain('Fehlerfälle testen');
    expect(md).toContain('Retrospektive');
    expect(md).toContain('2 Beobachtung(en)');
    expect(md).toContain('developer');
  });
});

describe('ensureLibrarySkills', () => {
  it('legt einen fehlenden Skill an', async () => {
    const { client, library } = createClient();

    const result = await ensureLibrarySkills(client, 'company-1', [skill()]);

    expect(result.created).toEqual(['agent-scrum-learning-skill-1']);
    expect(library).toHaveLength(1);
    expect(result.slugs.get('skill-1')).toBe('agent-scrum-learning-skill-1');
  });

  it('verwendet einen vorhandenen Skill wieder', async () => {
    const { client } = createClient([
      {
        id: 'x',
        key: 'company/company-1/agent-scrum-learning-skill-1',
        slug: 'agent-scrum-learning-skill-1',
        name: 'Alt',
      },
    ]);

    const result = await ensureLibrarySkills(client, 'company-1', [skill()]);

    expect(result.created).toEqual([]);
    expect(result.reused).toEqual(['agent-scrum-learning-skill-1']);
    expect(client.createCompanySkill).not.toHaveBeenCalled();
  });

  it('legt bei mehreren Retros kein Duplikat an', async () => {
    const { client, library } = createClient();

    await ensureLibrarySkills(client, 'company-1', [skill()]);
    await ensureLibrarySkills(client, 'company-1', [skill({ reinforcementCount: 5 })]);

    expect(library).toHaveLength(1);
  });
});

describe('assignSkillsToAgent', () => {
  let existing: Array<{ key: string; desired: boolean }>;
  beforeEach(() => {
    existing = [
      { key: 'fremder-skill', desired: true },
      { key: 'abgewaehlter', desired: false },
    ];
  });

  it('behält bereits zugewiesene Skills bei', async () => {
    const { client, synced } = createClient([], existing);

    await assignSkillsToAgent(client, 'agent-1', ['scrum-neu']);

    // Der fremde Skill darf nicht verloren gehen
    expect(synced[0]).toContain('fremder-skill');
    expect(synced[0]).toContain('scrum-neu');
  });

  it('übernimmt keine abgewählten Skills', async () => {
    const { client, synced } = createClient([], existing);

    await assignSkillsToAgent(client, 'agent-1', ['scrum-neu']);

    expect(synced[0]).not.toContain('abgewaehlter');
  });

  it('schreibt nicht, wenn sich nichts ändert', async () => {
    const { client } = createClient([], [{ key: 'scrum-neu', desired: true }]);

    const changed = await assignSkillsToAgent(client, 'agent-1', ['scrum-neu']);

    expect(changed).toBe(false);
    expect(client.syncAgentSkills).not.toHaveBeenCalled();
  });

  it('entfernt Duplikate aus dem Sollzustand', async () => {
    const { client, synced } = createClient([], [{ key: 'scrum-a', desired: true }]);

    await assignSkillsToAgent(client, 'agent-1', ['scrum-a', 'scrum-b', 'scrum-b']);

    expect(synced[0].filter((s) => s === 'scrum-b')).toHaveLength(1);
  });

  it('kommt mit einem Agent ohne Skills zurecht', async () => {
    const { client, synced } = createClient([], []);

    const changed = await assignSkillsToAgent(client, 'agent-1', ['scrum-a']);

    expect(changed).toBe(true);
    expect(synced[0]).toEqual(['scrum-a']);
  });
});
