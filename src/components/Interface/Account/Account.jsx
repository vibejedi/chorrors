import { useEffect } from 'react';
import useAccount, { checkSession, shortWallet, signOut, SIGN_IN_URL } from '../../../services/accountService';
import './Account.css';

const REASONS = {
	clock_ahead: 'the game clock ran ahead of the server',
	speed: 'impossible movement',
	room_too_fast: 'a room was finished impossibly fast',
	room_from_outside: 'a room was finished from outside it',
	exit_locked: 'the exit was reached too early',
	duration: 'the run was too short or too long',
	restarted: 'a new run started',
};

const stop = (e) => e.stopPropagation();

/** Loading screen: nobody clocks in without signing in on horrors.fun. */
export function AccountGate() {
	const { checked, session } = useAccount();

	// Pick up the horrors.fun sign-in now, and again whenever the player comes back to this tab from signing in.
	useEffect(() => {
		checkSession();
		const recheck = () => {
			if (document.visibilityState === 'visible' && !useAccount.getState().session) checkSession();
		};
		document.addEventListener('visibilitychange', recheck);
		window.addEventListener('focus', recheck);
		return () => {
			document.removeEventListener('visibilitychange', recheck);
			window.removeEventListener('focus', recheck);
		};
	}, []);

	if (window.location.hash.includes('#debug')) return null;

	if (!checked) {
		return (
			<div className="account-panel lincoln-regular" onClick={stop}>
				<div className="account-note">Checking your sign-in…</div>
			</div>
		);
	}

	if (!session) {
		return (
			<div className="account-panel lincoln-regular" onClick={stop}>
				<a className="account-button" href={SIGN_IN_URL} target="_blank" rel="noopener">
					Sign in on horrors.fun
				</a>
				<div className="account-note">
					Free play or burn to play ranked: accounts live on horrors.fun. Sign in there, then come back to this tab.
				</div>
			</div>
		);
	}

	return (
		<div className="account-panel lincoln-regular" onClick={stop}>
			<div className="account-who">
				{session.ranked ? 'Ranked' : 'Free play'} as <strong>{session.username}</strong> · {shortWallet(session.wallet)}
			</div>
			{session.walletVerified && !session.ranked && (
				<a className="account-link" href={SIGN_IN_URL} target="_blank" rel="noopener">
					Burn on horrors.fun to play ranked this week
				</a>
			)}
			<button type="button" className="account-link" onClick={signOut}>
				Sign out
			</button>
		</div>
	);
}

const clock = (ms) => {
	const s = Math.floor(ms / 1000);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** End screen: what the server made of the run. */
export function RunResult() {
	const run = useAccount((s) => s.run);
	if (!run) return null;
	const label = run.mode === 'ranked' ? 'Ranked' : 'Free';

	let text;
	let tone = '';
	if (run.status === 'running') text = `${label}: checking your run…`;
	else if (run.status === 'done' && run.verdict === 'verified') {
		text = `${label} time verified: ${clock(run.durationMs)}`;
		tone = 'good';
	} else if (run.status === 'done' && run.verdict === 'flagged') text = `${label} time ${clock(run.durationMs)} is waiting for review`;
	else {
		text = `${label} run not counted: ${REASONS[run.reason] || run.reason || 'it could not be verified'}`;
		tone = 'bad';
	}
	return <div className={`run-result lincoln-regular ${tone}`}>{text}</div>;
}
