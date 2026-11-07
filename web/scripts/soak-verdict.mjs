// The verdict of the soak test (T9.3.2): the numbers and the criteria of docs/performance.md, from the rows of the log.
// Used by soak-check.mjs after a run, and alone on a log: `node scripts/soak-check.mjs --analyze ../data/work/soak.ndjson`.

/** least squares slope of y against x */
function slope(x, y) {
	const n = x.length;
	if (n < 3) return 0;
	const mx = x.reduce((a, b) => a + b, 0) / n;
	const my = y.reduce((a, b) => a + b, 0) / n;
	let num = 0;
	let den = 0;
	for (let i = 0; i < n; i++) {
		num += (x[i] - mx) * (y[i] - my);
		den += (x[i] - mx) ** 2;
	}
	return den ? num / den : 0;
}

const median = (a) => {
	const b = a.slice().sort((x, y) => x - y);
	return b.length ? b[b.length >> 1] : null;
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export function verdictOf(all, { engine = 'msedge', errors = [], ended, reachedS } = {}) {
	// the sample taken after the recording has ended says nothing about drift (real time goes on, the audio does not)
	const rows = all.filter((r) => r.status !== 'ended' && r.piece);
	const hours = (r) => r.wall_s / 3600;
	const second = rows.slice(Math.floor(rows.length / 2));
	const heap = second.filter((r) => r.heapMb != null);
	const proc = second.filter((r) => r.processMb != null);
	const last = rows.at(-1);
	// A leak is growth that goes on while nothing new is loaded. Memory does grow in steps where something new is used for the
	// first time (the first visit to a scene compiles its shaders, a piece loads its notes, a preset its program) and then holds.
	// So: the slope inside each piece (after its first samples), and whether the later part of the run has settled.
	const segments = [];
	for (const r of rows) {
		const seg = segments.at(-1);
		if (seg && seg[0].piece === r.piece) seg.push(r);
		else segments.push([r]);
	}
	const within = segments
		.map((seg) => seg.slice(3))
		.filter((seg) => seg.length >= 6)
		.map((seg) => ({
			piece: seg[0].piece,
			heap: slope(
				seg.map(hours),
				seg.map((r) => r.heapMb)
			),
			process:
				seg[0].processMb == null
					? null
					: slope(
							seg.map(hours),
							seg.map((r) => r.processMb)
						)
		}));
	const third = Math.floor(rows.length / 3);
	const middle = rows.slice(third, 2 * third);
	const lastThird = rows.slice(2 * third);
	const quarter = rows.slice(Math.floor(rows.length / 4));
	const first = rows[2] ?? rows[0];
	const worst = (f) => rows.reduce((a, r) => Math.max(a, Math.abs(f(r))), 0);
	// the audio hardware's clock and the system's differ by some tens of parts per million: that is a straight line in the
	// drift. A piece of audio lost (a dropout, a stall) is a step: the drift jumps between two samples.
	let step = 0;
	for (let i = 1; i < rows.length; i++)
		step = Math.max(step, Math.abs(rows[i].elementDriftMs - rows[i - 1].elementDriftMs));
	const summary = {
		engine,
		samples: rows.length,
		playedMinutes: last ? +(last.wall_s / 60).toFixed(1) : 0,
		reachedS: reachedS ?? last?.element_s ?? null,
		ended: ended ?? false,
		piecesVisited: new Set(rows.map((r) => r.piece).filter(Boolean)).size,
		heapStartMb: first?.heapMb ?? null,
		heapEndMb: last?.heapMb ?? null,
		heapSlopeSecondHalfMbPerHour: +slope(
			heap.map(hours),
			heap.map((r) => r.heapMb)
		).toFixed(2),
		heapWithinPieceSlopeMbPerHour: {
			pieces: within.length,
			median: +median(within.map((w) => w.heap))?.toFixed(2),
			largest: +Math.max(...within.map((w) => w.heap)).toFixed(2)
		},
		heapRangeAfterFirstQuarterMb: +(
			Math.max(...quarter.map((r) => r.heapMb)) - Math.min(...quarter.map((r) => r.heapMb))
		).toFixed(1),
		processStartMb: first?.processMb ?? null,
		processEndMb: last?.processMb ?? null,
		processSlopeSecondHalfMbPerHour: proc.length
			? +slope(
					proc.map(hours),
					proc.map((r) => r.processMb)
				).toFixed(1)
			: null,
		processMiddleThirdMeanMb: +mean(
			middle.map((r) => r.processMb).filter((x) => x != null)
		)?.toFixed(0),
		processLastThirdMeanMb: +mean(
			lastThird.map((r) => r.processMb).filter((x) => x != null)
		)?.toFixed(0),
		nodesStart: first?.nodes ?? null,
		nodesEnd: last?.nodes ?? null,
		listenersStart: first?.listeners ?? null,
		listenersEnd: last?.listeners ?? null,
		gpuObjectsStart: first?.gpuObjects ?? null,
		gpuObjectsEnd: last?.gpuObjects ?? null,
		elementDriftEndMs: last?.elementDriftMs ?? null,
		elementDriftPpm:
			last && last.wall_s ? +((1e3 * last.elementDriftMs) / last.wall_s).toFixed(1) : null,
		largestDriftStepMs: step,
		worstClockMinusElementMs: worst((r) => r.clockMinusElementMs),
		ctxMinusElementMsFinal: last?.ctxMinusElementMs ?? null,
		events: last?.events ?? null,
		levelsSeen: [...new Set(rows.map((r) => r.gpuObjects?.level))].join(','),
		worstFrameShareOver25ms: +Math.max(
			...rows.map((r) => (r.frames.n ? (100 * r.frames.over25) / r.frames.n : 0))
		).toFixed(2),
		errors: errors.slice(0, 5)
	};
	summary.checks = {
		reachedTheEnd: summary.ended && summary.piecesVisited >= 18,
		heapFlat:
			summary.heapWithinPieceSlopeMbPerHour.median < 5 && summary.heapRangeAfterFirstQuarterMb < 40,
		processFlat: summary.processLastThirdMeanMb - summary.processMiddleThirdMeanMb < 40,
		domAndListenersFlat:
			Math.abs(summary.nodesEnd - summary.nodesStart) < 100 &&
			summary.listenersEnd === summary.listenersStart,
		noDroppedAudio:
			!!summary.events &&
			summary.events.error === 0 &&
			summary.events.stalled === 0 &&
			summary.events.waiting <= 3 &&
			summary.largestDriftStepMs <= 80,
		clockOnElement: summary.worstClockMinusElementMs <= 50,
		framesSmooth: summary.worstFrameShareOver25ms <= 1,
		noErrors: errors.length === 0
	};
	return summary;
}
