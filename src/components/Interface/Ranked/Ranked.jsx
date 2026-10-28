import useRanked, { getWalletProvider, shortWallet, signInWithWallet, signOut } from '../../../services/rankedService';
import './Ranked.css';

const ERRORS = {
	no_wallet: 'No Solana wallet found. Open this page in Phantom or Solflare.',
	declined: 'Signature declined.',
};

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

/** Loading screen: choose ranked (wallet) or casual before starting. */
export function RankedPanel() {
	const { session, enabled, signingIn, error, setEnabled } = useRanked();
	if (window.location.hash.includes('#debug')) return null;

	if (!session) {
		return (
			<div className="ranked-panel lincoln-regular" onClick={stop}>
				<button type="button" className="ranked-button" disabled={signingIn} onClick={signInWithWallet}>
					{signingIn ? 'Check your wallet…' : 'Play ranked: connect wallet'}
				</button>
				{error && <div className="ranked-note">{ERRORS[error] || 'Could not sign in. Try again.'}</div>}
				{!error && !getWalletProvider() && <div className="ranked-note">Needs a Solana wallet such as Phantom</div>}
			</div>
		);
	}

	return (
		<div className="ranked-panel lincoln-regular" onClick={stop}>
			<label className="ranked-toggle">
				<input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
				<span>{enabled ? 'Ranked' : 'Casual'} as {shortWallet(session.wallet)}</span>
			</label>
			<button type="button" className="ranked-link" onClick={signOut}>
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
export function RankedResult() {
	const run = useRanked((s) => s.run);
	if (!run) return null;

	let text;
	let tone = '';
	if (run.status === 'running') text = 'Ranked: checking your run…';
	else if (run.status === 'rejected') {
		text = `Ranked run not counted: ${REASONS[run.reason] || run.reason || 'it could not be verified'}`;
		tone = 'bad';
	} else if (run.verdict === 'verified') {
		text = `Ranked time verified: ${clock(run.durationMs)}`;
		tone = 'good';
	} else if (run.verdict === 'flagged') text = `Ranked time ${clock(run.durationMs)} is waiting for review`;
	else {
		text = `Ranked run not counted: ${REASONS[run.reason] || run.reason}`;
		tone = 'bad';
	}

	return <div className={`ranked-result lincoln-regular ${tone}`}>{text}</div>;
}
