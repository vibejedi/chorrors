import { useEffect, useState } from 'react';
import useAccount, {
	burnForRanked,
	claimUsername,
	connectWallet,
	getWalletProvider,
	loadTokenConfig,
	refreshAccount,
	shortWallet,
	signInFree,
	signOut,
} from '../../../services/accountService';
import './Account.css';

const ERRORS = {
	no_wallet: 'No Solana wallet found. Open this page in Phantom or Solflare.',
	declined: 'Request declined in your wallet.',
	bad_username: 'Usernames are 3–20 letters, numbers, dots, dashes or underscores.',
	bad_wallet: 'That is not a Solana wallet address.',
	bad_password: 'Passwords need at least 8 characters.',
	wrong_password: 'Wrong password for that username.',
	username_taken: 'That username is taken. If it is yours, enter its password.',
	wallet_account: 'That username plays with a connected wallet. Use Burn to play ranked.',
	wallet_locked: 'That account is tied to a connected wallet; leave the wallet blank to log in.',
	wallet_taken: 'That wallet already has an account. Connect it again to sign in.',
	claim_expired: 'That took too long. Connect your wallet again.',
	rate_limited: 'Too many tries. Wait a minute.',
	not_launched: '$HORRORS has not launched yet. Burns open the moment it does.',
	burn_unconfirmed: 'The burn did not confirm in time. If it went through, press Burn again: it will not burn twice.',
	burn_used: 'That burn was already used.',
	bad_signature: 'Your wallet did not return a valid transaction. Try again.',
	failed_on_chain: 'The burn failed on-chain. Nothing was burned; try again.',
	no_burn_of_this_token: 'That transaction did not burn $HORRORS.',
	burn_too_small: 'That burn was smaller than the amount ranked needs.',
	burn_from_other_wallet: 'That burn came from a different wallet.',
	wrong_wallet: 'Switch your wallet to the account you signed in with.',
	connect_wallet: 'Connect your wallet first.',
};
const errorText = (e) => (e ? ERRORS[e] || 'Something went wrong. Try again.' : null);

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

function FreeForm() {
	const busy = useAccount((s) => s.busy);
	const [username, setUsername] = useState(() => localStorage.getItem('skullhotel_last_player_name') || '');
	const [wallet, setWallet] = useState('');
	const [password, setPassword] = useState('');
	return (
		<form
			className="account-form"
			onSubmit={(e) => {
				e.preventDefault();
				signInFree({ username, wallet, password });
			}}
		>
			<input aria-label="Username" placeholder="Username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
			<input aria-label="Payout wallet address" placeholder="Solana wallet address (for payouts)" value={wallet} onChange={(e) => setWallet(e.target.value)} spellCheck={false} />
			<input aria-label="Password" type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
			<button type="submit" className="account-button" disabled={busy === 'signin' || !username || !password}>
				{busy === 'signin' ? 'Signing in…' : 'Play free'}
			</button>
			<div className="account-note">Returning? Your username and password are enough.</div>
		</form>
	);
}

function RankedForm() {
	const { busy, claim, token } = useAccount();
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const price = token?.burnAmount ? `${token.burnAmount.toLocaleString()} ${token.ticker}` : '$HORRORS';

	if (claim) {
		return (
			<form
				className="account-form"
				onSubmit={(e) => {
					e.preventDefault();
					claimUsername({ username, password });
				}}
			>
				<div className="account-note">Wallet {shortWallet(claim.wallet)} connected. Pick a username.</div>
				<input aria-label="Username" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
				<input
					aria-label="Password of your free account (optional)"
					type="password"
					placeholder="Free account password (only to link one)"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
				/>
				<button type="submit" className="account-button" disabled={busy === 'signin' || !username}>
					{busy === 'signin' ? 'Saving…' : 'Continue'}
				</button>
			</form>
		);
	}

	return (
		<div className="account-form">
			<button type="button" className="account-button" disabled={busy === 'wallet'} onClick={connectWallet}>
				{busy === 'wallet' ? 'Check your wallet…' : 'Connect wallet'}
			</button>
			<div className="account-note">
				Ranked needs a connected Solana wallet and a one-time burn of {price} for the season. The ranked board splits the $PUMP pool.
				{!getWalletProvider() && ' Open this page in Phantom or Solflare.'}
			</div>
		</div>
	);
}

/** Loading screen: nobody clocks in without an account. */
export function AccountGate() {
	const { session, busy, error, token } = useAccount();
	const [tab, setTab] = useState('free');

	useEffect(() => {
		loadTokenConfig();
		refreshAccount();
	}, []);

	if (window.location.hash.includes('#debug')) return null;

	if (session) {
		const mode = session.ranked ? 'Ranked' : 'Free play';
		return (
			<div className="account-panel lincoln-regular" onClick={stop}>
				<div className="account-who">
					{mode} as <strong>{session.username}</strong> · {shortWallet(session.wallet)}
				</div>
				{session.walletVerified && !session.ranked && (
					<>
						<button type="button" className="account-button small" disabled={busy === 'burn' || !token?.launched} onClick={burnForRanked}>
							{busy === 'burn'
								? 'Burning…'
								: token?.launched
									? `Burn ${token.burnAmount.toLocaleString()} ${token.ticker} for ranked`
									: '$HORRORS launches soon'}
						</button>
						{!token?.launched && <div className="account-note">Until then your runs count on the free board.</div>}
					</>
				)}
				{error && <div className="account-error" role="alert">{errorText(error)}</div>}
				<button type="button" className="account-link" onClick={signOut}>
					Sign out
				</button>
			</div>
		);
	}

	return (
		<div className="account-panel lincoln-regular" onClick={stop}>
			<div className="account-tabs" role="tablist">
				<button type="button" role="tab" aria-selected={tab === 'free'} className={tab === 'free' ? 'active' : ''} onClick={() => setTab('free')}>
					Free play
				</button>
				<button type="button" role="tab" aria-selected={tab === 'ranked'} className={tab === 'ranked' ? 'active' : ''} onClick={() => setTab('ranked')}>
					Burn to play ranked
				</button>
			</div>
			{tab === 'free' ? <FreeForm /> : <RankedForm />}
			{error && <div className="account-error" role="alert">{errorText(error)}</div>}
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
