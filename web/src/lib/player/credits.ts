/**
 * What the credits page says about the MilkDrop presets (T7.5.3): built from the same `curated.json` that
 * `pnpm ambient-presets` copies the files from, so the page and the files cannot disagree. A preset's package name
 * carries its author ("martin - blue mountains", "Rovastar - Hyperspace").
 */

export interface CuratedFile {
	presets: Record<string, { source: string; mood?: string; scenes?: string[] }>;
}

export interface PresetCredit {
	id: string;
	/** the preset's name as the pack has it */
	name: string;
	/** the part before " - ", capitalised as written */
	author: string;
	/** the part after it */
	title: string;
}

export function presetCredits(curated: CuratedFile): PresetCredit[] {
	return Object.entries(curated.presets)
		.map(([id, p]) => {
			const i = p.source.indexOf(' - ');
			const author = i > 0 ? p.source.slice(0, i).trim() : 'unknown';
			const title = i > 0 ? p.source.slice(i + 3).trim() : p.source;
			return { id, name: p.source, author, title };
		})
		.sort((a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title));
}

/** The authors, each once (spelled as the first preset spells them), in alphabetical order. */
export function presetAuthors(credits: readonly PresetCredit[]): string[] {
	const seen = new Map<string, string>();
	for (const c of credits)
		if (!seen.has(c.author.toLowerCase())) seen.set(c.author.toLowerCase(), c.author);
	return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
