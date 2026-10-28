// Player accounts and server-verified runs, backed by api.horrors.fun.
//
// Nobody clocks in without an account:
//   free   - username, payout wallet address and a password (the same username + password logs back in)
//   ranked - connect a Solana wallet, pick a username, and burn $HORRORS once for the season
// Every run streams to the server, which times it on its own clock and checks it. This file only reports what
// happens in the game; it never decides a result.
import { create } from 'zustand';
import useGame from '../hooks/useGame';
import useInterface from '../hooks/useInterface';

const API = import.meta.env.VITE_HORRORS_API || 'https://api.horrors.fun';
const STORAGE_KEY = 'horrors_account_session';
const LAST_NAME_KEY = 'skullhotel_last_player_name';
const FLUSH_MS = 3000;
const BURN_POLL_MS = 3000;
const BURN_POLL_TRIES = 40;

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

const useAccount = create((set) => ({
	session: loadSession(), // { token, expiresAt, username, wallet, walletVerified, ranked }
	busy: null, // what we're waiting on, for the UI: 'signin' | 'wallet' | 'burn'
	error: null,
	claim: null, // a new wallet waiting for a username
	token: null, // $HORRORS config from the server
	run: null, // { id, mode, status: 'running' | 'rejected' | 'done', reason, verdict, durationMs }
	set: (patch) => set(patch),
}));

export default useAccount;

const patch = (p) => useAccount.getState().set(p);

/** The loading screen may only clock in once a player is signed in. */
export const canClockIn = () => isDebug() || !!useAccount.getState().session;

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

function saveSession(session) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
	// The guest book on the end screen starts with the account's name.
	localStorage.setItem(LAST_NAME_KEY, session.username);
	patch({ session, busy: null, error: null, claim: null });
}

export function signOut() {
	localStorage.removeItem(STORAGE_KEY);
	patch({ session: null, run: null, claim: null, error: null });
}

export async function loadTokenConfig() {
	try {
		patch({ token: await api('/v1/token') });
	} catch {
		// The panel shows ranked as unavailable until this loads.
	}
}

/** Re-reads the account (ranked status can change after a burn) and drops a session the server no longer accepts. */
export async function refreshAccount() {
	const { session } = useAccount.getState();
	if (!session) return;
	try {
		const me = await api('/v1/me', { token: session.token });
		saveSession({ ...session, ...me });
	} catch (err) {
		if (err.status === 401 || err.status === 403) signOut();
	}
}

// ---------- free play ----------

export async function signInFree({ username, wallet, password }) {
	patch({ busy: 'signin', error: null });
	try {
		const body = { username: username.trim(), password };
		if (wallet.trim()) body.wallet = wallet.trim();
		saveSession(await api('/v1/accounts/free', { method: 'POST', body }));
	} catch (err) {
		patch({ busy: null, error: err.message });
	}
}

// ---------- wallet connect (ranked) ----------

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));

export async function connectWallet() {
	const provider = getWalletProvider();
	if (!provider) {
		patch({ error: 'no_wallet' });
		return;
	}
	patch({ busy: 'wallet', error: null });
	try {
		const { publicKey } = await provider.connect();
		const wallet = publicKey.toString();
		const { nonce, message } = await api('/v1/auth/nonce', { method: 'POST', body: { wallet } });
		const signed = await provider.signMessage(new TextEncoder().encode(message), 'utf8');
		const signature = toBase64(signed.signature || signed);
		const res = await api('/v1/auth/verify', { method: 'POST', body: { wallet, nonce, signature } });
		if (res.needsUsername) patch({ busy: null, claim: { ticket: res.claim, wallet } });
		else saveSession(res);
	} catch (err) {
		patch({ busy: null, error: err.code === 4001 ? 'declined' : err.message });
	}
}

/** A new wallet picks a username, or attaches itself to an existing free account with that account's password. */
export async function claimUsername({ username, password }) {
	const { claim } = useAccount.getState();
	if (!claim) return;
	patch({ busy: 'signin', error: null });
	try {
		const body = { claim: claim.ticket, username: username.trim() };
		if (password) body.password = password;
		saveSession(await api('/v1/auth/claim', { method: 'POST', body }));
	} catch (err) {
		patch({ busy: null, error: err.message === 'claim_expired' ? 'claim_expired' : err.message, ...(err.message === 'claim_expired' ? { claim: null } : {}) });
	}
}

// ---------- burn to play ranked (ported from GoldScape's burn-to-play) ----------

const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

export async function burnForRanked() {
	const { session } = useAccount.getState();
	const provider = getWalletProvider();
	if (!session?.walletVerified || !provider) {
		patch({ error: 'connect_wallet' });
		return;
	}
	patch({ busy: 'burn', error: null });
	try {
		const prep = await api('/v1/burn/prepare', { token: session.token });
		if (!prep.launched) throw new Error('not_launched');
		const { PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram } = await import('@solana/web3.js');
		const owner = new PublicKey(session.wallet);
		const mint = new PublicKey(prep.mint);
		const tokenProgram = new PublicKey(prep.tokenProgram);
		// The player's token account for this mint (the associated token account).
		const [account] = PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], new PublicKey(ATA_PROGRAM));
		// SPL BurnChecked: instruction 15, amount as u64 little-endian, then decimals.
		const data = new Uint8Array(10);
		data[0] = 15;
		new DataView(data.buffer).setBigUint64(1, BigInt(prep.burnAmount) * 10n ** BigInt(prep.decimals), true);
		data[9] = prep.decimals;
		const tx = new Transaction();
		// Priority fee: without one a burn can sit unconfirmed on a busy network until its blockhash expires.
		tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }));
		tx.add(
			new TransactionInstruction({
				programId: tokenProgram,
				keys: [
					{ pubkey: account, isSigner: false, isWritable: true },
					{ pubkey: mint, isSigner: false, isWritable: true },
					{ pubkey: owner, isSigner: true, isWritable: false },
				],
				data,
			})
		);
		tx.feePayer = owner;
		tx.recentBlockhash = prep.blockhash;

		await provider.connect();
		if (provider.publicKey && provider.publicKey.toString() !== session.wallet) throw new Error('wrong_wallet');
		const sent = await provider.signAndSendTransaction(tx);
		const signature = typeof sent === 'string' ? sent : sent.signature;

		// The server re-reads the burn from the chain; it may take a few seconds to show up.
		for (let i = 0; i < BURN_POLL_TRIES; i++) {
			const res = await api('/v1/burn', { method: 'POST', token: session.token, body: { signature } });
			if (res.ok) {
				saveSession({ ...session, ranked: res.ranked });
				return;
			}
			await new Promise((r) => setTimeout(r, BURN_POLL_MS));
		}
		throw new Error('burn_unconfirmed');
	} catch (err) {
		patch({ busy: null, error: err.code === 4001 ? 'declined' : err.message });
	}
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
		stopRun({ status: 'done', verdict: res.verdict, reason: res.reason, durationMs: res.durationMs });
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
		if (err.status === 401 || err.status === 403) signOut();
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
