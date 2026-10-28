// Thin client for the Horrors.Fun Supabase project's REST API (PostgREST).
// The anon key is public by design; row-level security on the tables decides what it can do.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const rest = async (path, { method = 'GET', body, prefer, range, signal } = {}) => {
	if (!isSupabaseConfigured) {
		throw new Error('Supabase is not configured');
	}
	const headers = {
		apikey: SUPABASE_ANON_KEY,
		Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
		'Content-Type': 'application/json',
	};
	if (prefer) headers.Prefer = prefer;
	if (range) headers.Range = range;

	const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
		signal,
	});
	if (!response.ok) {
		throw new Error(`Supabase ${response.status}: ${await response.text()}`);
	}
	return response;
};

// Total row count from a `Prefer: count=exact` response's Content-Range header, e.g. "0-19/57".
export const countFrom = (response) => {
	const total = response.headers.get('content-range')?.split('/')[1];
	return total && total !== '*' ? Number(total) : 0;
};
