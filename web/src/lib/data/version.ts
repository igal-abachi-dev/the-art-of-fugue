/**
 * The build id of the shipped data (T9.1.2).
 *
 * The data and the samples keep their file names, so a long `immutable` cache is only safe if the URL changes when a file does.
 * `python -m artfugue.fingerprint` hashes every file under `static/data` and `static/samples` and writes the first ten
 * characters into the manifest as `build`; every fetch of those files then asks for `…?v=<build>`. The manifest itself is
 * fetched without a version and revalidated (it is what says which version is current). The audio files carry their own hash
 * in the `src` the manifest gives (`/audio/fugue.webm?v=…`), so they need nothing here.
 *
 * Without an id (a manifest made by an older pipeline, a test) URLs are left as they are.
 */
let build = '';

export function setBuild(id: string | null | undefined): void {
	build = id ?? '';
}

export function currentBuild(): string {
	return build;
}

/** `url` with the build id as its query, or unchanged if there is none (or the URL already has a query). */
export function versioned(url: string): string {
	if (!build || url.includes('?')) return url;
	return `${url}?v=${build}`;
}
