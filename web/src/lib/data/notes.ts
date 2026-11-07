/** Loader for the timed-note chunks written by `python -m artfugue.export` (format "AFN1"). */

export interface ColumnSpec {
	name: string;
	type: 'f4' | 'u4' | 'u1' | 'u2';
}

export interface NoteColumns {
	n: number;
	t_on: Float32Array;
	t_off: Float32Array;
	tick: Uint32Array;
	pitch: Uint8Array;
	voice: Uint8Array;
	vel: Uint8Array;
	conf: Uint8Array;
	bar: Uint16Array;
	flags: Uint16Array;
	pass: Uint8Array;
}

const CTOR = { f4: Float32Array, u4: Uint32Array, u1: Uint8Array, u2: Uint16Array } as const;
const HEADER = 16;

/** Typed-array views over the buffer (no copy). Columns are padded to 4 bytes. */
export function parseNotes(buf: ArrayBuffer, format: ColumnSpec[]): NoteColumns {
	if (buf.byteLength < HEADER) throw new Error('truncated note chunk (shorter than its header)');
	const head = new DataView(buf, 0, HEADER);
	const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
	if (magic !== 'AFN1') throw new Error(`not a note chunk (magic ${magic})`);
	if (head.getUint32(4, true) !== 1)
		throw new Error(`unsupported note chunk version ${head.getUint32(4, true)}`);
	const n = head.getUint32(8, true);
	// the size the header promises, before any column is cut out of the buffer (a cut file is a clear error, not a RangeError)
	let need = HEADER;
	for (const col of format) {
		need += n * CTOR[col.type].BYTES_PER_ELEMENT;
		need += (4 - (need % 4)) % 4;
	}
	if (need > buf.byteLength)
		throw new Error(
			`truncated note chunk (${buf.byteLength} bytes, ${need} needed for ${n} notes)`
		);
	const out: Record<string, unknown> = { n };
	let pos = HEADER;
	for (const col of format) {
		const C = CTOR[col.type];
		out[col.name] = new C(buf, pos, n);
		pos += n * C.BYTES_PER_ELEMENT;
		pos += (4 - (pos % 4)) % 4;
	}
	return out as unknown as NoteColumns;
}
