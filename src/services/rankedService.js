// Ranked play: sign in with a Solana wallet, then stream the run to api.horrors.fun so the server can time it
// and check it. The server's clock decides the result; this file only reports what happens in the game.
import { create } from 'zustand';
import useGame from '../hooks/useGame';
import useInterface from '../hooks/useInterface';

const API = import.meta.env.VITE_HORRORS_API || 'https://api.horrors.fun';
const STORAGE_KEY = 'horrors_ranked_session';
const LAST_NAME_KEY = 'skullhotel_last_player_name';
const FLUSH_MS = 3000;

const isDebug = () => window.location.hash.includes('#debug');

function loadSession() {
	try {
		const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
		return s && s.expiresAt > Date.now() + 60 * 60 * 1000 ? s : null;
	} catch {
		return null;
	}
}

export const shortWallet = (w) => (w ? `${w.slice(0, 4)}…${w.slice(-4)}` : '');

export function getWalletProvider() {
	return window.phantom?.solana || window.solflare || window.backpack || window.solana || null;
}

const useRanked = create((set) => ({
	session: loadSession(), // { wallet, token, expiresAt }
	enabled: !!loadSession(), // play this run ranked
	signingIn: false,
	error: null,
	run: null, // { id, status: 'running' | 'rejected' | 'done', reason, verdict, durationMs }
	setEnabled: (enabled) => set({ enabled }),
	set: (patch) => set(patch),
}));

export default useRanked;

async function api(path, { method = 'GET', body, token } = {}) {
	const res = await fetch(API + path, {
		method,
		headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw Object.assign(new Error(data.error || `http_${res.status}`), { status: res.status, data });
	return data;
}

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));

export async function signInWithWallet() {
	const provider = getWalletProvider();
	if (!provider) {
		useRanked.getState().set({ error: 'no_wallet' });
		return;
	}
	useRanked.getState().set({ signingIn: true, error: null });
	try {
		const { publicKey } = await provider.connect();
		const wallet = publicKey.toString();
		const { nonce, message } = await api('/v1/auth/nonce', { method: 'POST', body: { wallet } });
		const signed = await provider.signMessage(new TextEncoder().encode(message), 'utf8');
		const signature = toBase64(signed.signature || signed);
		const session = await api('/v1/auth/verify', { method: 'POST', body: { wallet, nonce, signature } });
		localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
		useRanked.getState().set({ session, enabled: true, signingIn: false });
		const name = localStorage.getItem(LAST_NAME_KEY);
		if (name) setRankedName(name);
	} catch (err) {
		useRanked.getState().set({ signingIn: false, error: err.code === 4001 ? 'declined' : err.message });
	}
}

export function signOut() {
	localStorage.removeItem(STORAGE_KEY);
	useRanked.getState().set({ session: null, enabled: false, run: null });
}

export function setRankedName(name) {
	const { session } = useRanked.getState();
	if (session) api('/v1/me', { method: 'POST', token: session.token, body: { displayName: name } }).catch(() => {});
}

// ---------- the live run ----------

let live = null; // { id, token, t0, seq, queue, inFlight, timer }

const now = () => Math.round(performance.now() - live.t0);

export function rankedEvent(event) {
	if (!live || useRanked.getState().run?.status !== 'running') return;
	live.queue.push({ t: now(), ...event });
}

/** Called by the in-scene tracker once a second with the camera position. */
export function rankedPosition(x, z) {
	rankedEvent({ k: 'p', x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 });
}

async function flush() {
	if (!live || live.inFlight) return;
	if (!live.batch && live.queue.length) {
		live.batch = { seq: live.seq, events: live.queue.splice(0, 200) };
	}
	if (!live.batch) return;
	live.inFlight = true;
	const run = live;
	try {
		const res = await api(`/v1/cleaning/runs/${run.id}/events`, { method: 'POST', token: run.token, body: run.batch });
		run.seq += 1;
		run.batch = null;
		if (res.exited) await finish(run);
	} catch (err) {
		if (err.status === 409 || err.status === 404 || err.status === 401) {
			stopRun({ status: 'rejected', reason: err.data?.reason || err.message });
		}
		// Network trouble: keep the same batch and retry on the next tick. The server ignores repeats.
	} finally {
		run.inFlight = false;
	}
}

async function finish(run) {
	try {
		const name = localStorage.getItem(LAST_NAME_KEY) || undefined;
		const res = await api(`/v1/cleaning/runs/${run.id}/finish`, { method: 'POST', token: run.token, body: { name } });
		stopRun({ status: 'done', verdict: res.verdict, reason: res.reason, durationMs: res.durationMs });
	} catch (err) {
		stopRun({ status: 'rejected', reason: err.data?.reason || err.message });
	}
}

function stopRun(result) {
	if (live) clearInterval(live.timer);
	const id = live?.id;
	live = null;
	useRanked.getState().set({ run: { id, ...result } });
}

async function startRun() {
	const { session, enabled } = useRanked.getState();
	if (live) stopRun({ status: 'rejected', reason: 'restarted' });
	if (!enabled || !session || isDebug()) {
		useRanked.getState().set({ run: null });
		return;
	}
	try {
		const { runId } = await api('/v1/cleaning/runs', { method: 'POST', token: session.token });
		// The client clock starts only once the server has stamped the start, so it can never run ahead.
		live = { id: runId, token: session.token, t0: performance.now(), seq: 0, queue: [], batch: null, inFlight: false };
		live.timer = setInterval(flush, FLUSH_MS);
		useRanked.getState().set({ run: { id: runId, status: 'running' } });
	} catch (err) {
		if (err.status === 401) signOut();
		useRanked.getState().set({ run: { status: 'rejected', reason: err.message } });
	}
}

// ---------- game hooks ----------

const doneRooms = (objectives) =>
	objectives.reduce((acc, room, i) => (room.every(Boolean) ? [...acc, i] : acc), []);

let prevDone = [];
let lastCamera = null;

export function noteCamera(x, z) {
	lastCamera = { x, z };
}

// A new shift starts whenever the game stamps a new start time (first start and "play again").
useGame.subscribe(
	(s) => s.gameStartTime,
	() => startRun()
);

// The death screen's restart button is where the game counts a death.
useGame.subscribe(
	(s) => s.realDeaths,
	(deaths, before) => {
		if (deaths > before) rankedEvent({ k: 'death' });
	}
);

// A room counts once all five of its chores are done.
useInterface.subscribe(
	(s) => s.interfaceObjectives,
	(objectives) => {
		const done = doneRooms(objectives);
		for (const r of done) if (!prevDone.includes(r)) rankedEvent({ k: 'room', r });
		prevDone = done;
	}
);

// Walking out of the reception ends the shift.
useGame.subscribe(
	(s) => s.end,
	(end) => {
		if (!end || !live) return;
		if (lastCamera) rankedPosition(lastCamera.x, lastCamera.z);
		rankedEvent({ k: 'exit' });
		flush();
	}
);
