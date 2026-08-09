const ACCEPTANCE_CRITERIA_HEADINGS = new Set(['akzeptanzkriterien', 'acceptance criteria']);

export function descriptionWithoutAcceptanceCriteria(description: string): string {
  let omittedHeadingLevel: number | null = null;
  const visibleLines: string[] = [];

  for (const line of description.split('\n')) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim().toLocaleLowerCase();
      if (ACCEPTANCE_CRITERIA_HEADINGS.has(title)) {
        omittedHeadingLevel = level;
        continue;
      }
      if (omittedHeadingLevel !== null && level <= omittedHeadingLevel) {
        omittedHeadingLevel = null;
      }
    }

    if (omittedHeadingLevel === null) visibleLines.push(line);
  }

  return visibleLines.join('\n').trim();
}