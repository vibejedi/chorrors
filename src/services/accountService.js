// Player accounts and server-verified runs, backed by api.horrors.fun.
//
// Players sign up, sign in and burn on horrors.fun, never here. That sets a session cookie for all of horrors.fun;
// this game swaps it for a bearer token (POST /v1/auth/session). Nobody clocks in without one:
//   free   - username, payout wallet address and a password
//   ranked - connected Solana wallet that burned $HORRORS for the week
// Every run streams to the server, which times it on its own clock and checks it. This file only reports what
// happens in the game; it never decides a result.
import { create } from 'zustand';
import useGame from '../hooks/useGame';
import useInterface from '../hooks/useInterface';

const API = import.meta.env.VITE_HORRORS_API || 'https://api.horrors.fun';
export const SIGN_IN_URL = 'https://horrors.fun/#play';
export const DASHBOARD_URL = 'https://horrors.fun/#dashboard';
const LAST_NAME_KEY = 'skullhotel_last_player_name';
const FLUSH_MS = 3000;

const isDebug = () => window.location.hash.includes('#debug');

export const shortWallet = (w) => (w ? `${w.slice(0, 4)}…${w.slice(-4)}` : '');

const useAccount = create((set) => ({
	checked: false, // the first session check has finished
	session: null, // { token, expiresAt, username, wallet, walletVerified, ranked }
	run: null, // { id, mode, status: 'running' | 'rejected' | 'done', reason, verdict, durationMs, achievements }
	set: (patch) => set(patch),
}));

export default useAccount;

const patch = (p) => useAccount.getState().set(p);

/** The loading screen may only clock in once a player is signed in. */
export const canClockIn = () => isDebug() || !!useAccount.getState().session;

async function api(path, { method = 'GET', body, token } = {}) {
	const res = await fetch(API + path, {
		method,
		credentials: 'include', // the horrors.fun session cookie
		headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
		body: body ? JSON.stringify(body) : undefined,
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw Object.assign(new Error(data.error || `http_${res.status}`), { status: res.status, data });
	return data;
}

/** Picks up the sign-in from horrors.fun. Safe to call again, e.g. when the player comes back to this tab. */
export async function checkSession() {
	try {
		const session = await api('/v1/auth/session', { method: 'POST' });
		// The guest book on the end screen starts with the account's name.
		localStorage.setItem(LAST_NAME_KEY, session.username);
		patch({ session, checked: true });
	} catch (err) {
		if (err.status === 401 || err.status === 403) patch({ session: null });
		patch({ checked: true });
	}
}

export function signOut() {
	api('/v1/auth/logout', { method: 'POST' }).catch(() => {});
	patch({ session: null, run: null });
}

// ---------- the live run ----------

let live = null; // { id, token, t0, seq, queue, batch, inFlight, timer }

const now = () => Math.round(performance.now() - live.t0);

export function runEvent(event) {
	if (!live || useAccount.getState().run?.status !== 'running') return;
	live.queue.push({ t: now(), ...event });
}

/** Called by the in-scene tracker once a second with the camera position. */
export function runPosition(x, z) {
	runEvent({ k: 'p', x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 });
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
		const res = await api(`/v1/cleaning/runs/${run.id}/finish`, { method: 'POST', token: run.token });
		stopRun({ status: 'done', verdict: res.verdict, reason: res.reason, durationMs: res.durationMs, achievements: res.achievements || [] });
	} catch (err) {
		stopRun({ status: 'rejected', reason: err.data?.reason || err.message });
	}
}

function stopRun(result) {
	if (live) clearInterval(live.timer);
	const { id, mode } = live || useAccount.getState().run || {};
	live = null;
	patch({ run: { id, mode, ...result } });
}

async function startRun() {
	const { session } = useAccount.getState();
	if (live) stopRun({ status: 'rejected', reason: 'restarted' });
	if (!session || isDebug()) {
		patch({ run: null });
		return;
	}
	try {
		const { runId, mode } = await api('/v1/cleaning/runs', { method: 'POST', token: session.token });
		// The client clock starts only once the server has stamped the start, so it can never run ahead.
		live = { id: runId, mode, token: session.token, t0: performance.now(), seq: 0, queue: [], batch: null, inFlight: false };
		live.timer = setInterval(flush, FLUSH_MS);
		patch({ run: { id: runId, mode, status: 'running' } });
	} catch (err) {
		if (err.status === 401 || err.status === 403) patch({ session: null });
		patch({ run: { status: 'rejected', reason: err.message } });
	}
}

// ---------- game hooks ----------

const doneRooms = (objectives) => objectives.reduce((acc, room, i) => (room.every(Boolean) ? [...acc, i] : acc), []);

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
		if (deaths > before) runEvent({ k: 'death' });
	}
);

// A room counts once all five of its chores are done.
useInterface.subscribe(
	(s) => s.interfaceObjectives,
	(objectives) => {
		const done = doneRooms(objectives);
		for (const r of done) if (!prevDone.includes(r)) runEvent({ k: 'room', r });
		prevDone = done;
	}
);

// Walking out of the reception ends the shift.
useGame.subscribe(
	(s) => s.end,
	(end) => {
		if (!end || !live) return;
		if (lastCamera) runPosition(lastCamera.x, lastCamera.z);
		runEvent({ k: 'exit' });
		flush();
	}
);
