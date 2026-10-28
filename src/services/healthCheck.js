import { isSupabaseConfigured, rest } from './supabase';

const PROBE_TIMEOUT_MS = 5000;

let cachedResult = null;
let pendingProbe = null;

// The end screen only offers to sign the guest book when the backend is actually reachable.
export const probeGuestBookReachability = () => {
	if (cachedResult !== null) {
		return Promise.resolve(cachedResult);
	}
	if (pendingProbe) {
		return pendingProbe;
	}

	const probe = (async () => {
		if (!isSupabaseConfigured) {
			cachedResult = false;
			return cachedResult;
		}
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
		try {
			await rest('cleaning_guestbook?select=id&limit=1', { signal: controller.signal });
			cachedResult = true;
		} catch {
			cachedResult = false;
		} finally {
			clearTimeout(timer);
		}
		return cachedResult;
	})();

	pendingProbe = probe;
	return probe;
};
