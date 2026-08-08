/**
 * Abgleich gelernter Skills mit der Paperclip-Skill-Bibliothek
 *
 * Paperclip führt Skills als eigenes Konzept: sie liegen in der Bibliothek der
 * Company und werden Agents einzeln zugewiesen. Ein in der Retrospektive
 * gelernter Skill wird deshalb zweistufig ausgeliefert:
 *
 *   1. `POST /api/companies/:companyId/skills` — in der Bibliothek anlegen
 *   2. `POST /api/agents/:id/skills/sync`      — dem Agent zuweisen
 *
 * Ergänzend schreibt der Worker den Skill-Abschnitt in die `AGENTS.md`
 * (siehe `instructions.ts`). Beides zusammen, weil die Skill-Bibliothek
 * adapterabhängig ist — unterstützt der Adapter des Agents keine Skills,
 * bleibt die Instruktionsdatei der wirksame Weg.
 */

import type { AgentSkill } from '@shared/types';

/**
 * Erzeugt einen URL-tauglichen Slug aus einem Skill-Namen.
 *
 * Der Slug ist der Schlüssel, über den ein Skill dem Agent zugewiesen wird —
 * er muss über Sprints hinweg stabil bleiben, damit derselbe Skill nicht
 * mehrfach in der Bibliothek landet.
 */
export function toSkillSlug(skill: AgentSkill): string {
  const base = skill.name
    .toLowerCase()
    // Umlaute zuerst ausschreiben: nach einer NFD-Zerlegung wäre "ä" bereits
    // "a" + Kombinationszeichen, und aus "Fehlerfälle" würde "fehlerfalle"
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    // Übrige Diakritika (é, à, …) auf den Grundbuchstaben reduzieren
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return base ? `scrum-${base}` : `scrum-skill-${skill.id.slice(0, 8)}`;
}

/**
 * Rendert den Skill als Markdown für die Bibliothek.
 *
 * Der Text enthält die Herkunft, damit im Paperclip-UI nachvollziehbar ist,
 * woher die Regel stammt und wie belastbar sie ist.
 */
export function toSkillMarkdown(skill: AgentSkill): string {
  return [
    `# ${skill.name}`,
    '',
    skill.description,
    '',
    '## Herkunft',
    '',
    `Aus der Sprint-Retrospektive des Scrum-Teams abgeleitet (${skill.category}).`,
    `Bestätigt durch ${skill.reinforcementCount} Beobachtung(en) auf dem Board.`,
    '',
    'Gilt für: ' + skill.roles.join(', '),
  ].join('\n');
}

/**
 * Minimalschnittstelle des Clients — hält dieses Modul unabhängig testbar.
 */
export interface SkillSyncClient {
  listCompanySkills(companyId: string): Promise<Array<{ id: string; slug: string; name: string }>>;
  createCompanySkill(
    companyId: string,
    params: {
      name: string;
      slug?: string;
      description?: string;
      markdown?: string;
      categories?: string[];
    }
  ): Promise<{ id: string; slug: string; name: string }>;
  listAgentSkills(agentId: string): Promise<{
    entries?: Array<{ key: string; desired: boolean }>;
  }>;
  syncAgentSkills(agentId: string, desiredSkills: string[]): Promise<unknown>;
}

export interface SkillSyncResult {
  /** Neu in der Bibliothek angelegte Slugs */
  created: string[];
  /** Bereits vorhandene, wiederverwendete Slugs */
  reused: string[];
  /** Agents, denen Skills zugewiesen wurden */
  assignedAgentIds: string[];
}

/**
 * Legt fehlende Skills in der Bibliothek an.
 *
 * Vorhandene Slugs werden wiederverwendet, statt ein Duplikat zu erzeugen —
 * ein bestärkter Skill soll denselben Bibliothekseintrag behalten.
 */
export async function ensureLibrarySkills(
  client: SkillSyncClient,
  companyId: string,
  skills: AgentSkill[]
): Promise<{ slugs: Map<string, string>; created: string[]; reused: string[] }> {
  const existing = await client.listCompanySkills(companyId);
  const bySlug = new Map(existing.map((s) => [s.slug, s]));

  const slugs = new Map<string, string>();
  const created: string[] = [];
  const reused: string[] = [];

  for (const skill of skills) {
    const slug = toSkillSlug(skill);
    slugs.set(skill.id, slug);

    if (bySlug.has(slug)) {
      reused.push(slug);
      continue;
    }

    await client.createCompanySkill(companyId, {
      name: skill.name,
      slug,
      description: skill.description,
      markdown: toSkillMarkdown(skill),
      categories: [skill.category],
    });
    created.push(slug);
  }

  return { slugs, created, reused };
}

/**
 * Weist einem Agent die Skills seiner Rolle zu.
 *
 * Wichtig: `syncAgentSkills` erwartet den *vollständigen* Sollzustand — nicht
 * genannte Skills werden abgewählt. Deshalb werden die bereits zugewiesenen
 * Skills des Agents zuerst gelesen und beibehalten, sonst würde das Plugin
 * fremde Zuweisungen stillschweigend entfernen.
 */
export async function assignSkillsToAgent(
  client: SkillSyncClient,
  agentId: string,
  slugs: string[]
): Promise<boolean> {
  const snapshot = await client.listAgentSkills(agentId);
  const current = (snapshot.entries ?? []).filter((e) => e.desired).map((e) => e.key);

  const desired = [...new Set([...current, ...slugs])];

  // Nichts Neues — kein unnötiger Schreibzugriff
  if (desired.length === current.length) return false;

  await client.syncAgentSkills(agentId, desired);
  return true;
}
