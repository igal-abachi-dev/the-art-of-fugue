import { describe, expect, it } from 'vitest';
import { APP_NAME } from './sanity';

describe('scaffold', () => {
	it('exposes the app name', () => {
		expect(APP_NAME).toBe('The Art of Fugue');
	});
});
