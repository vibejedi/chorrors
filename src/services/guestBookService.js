import { countFrom, rest } from './supabase';

const TABLE = 'cleaning_guestbook';
const DEBUG_SUFFIX = '_debug';
export const PAGE_SIZE = 20;
const MIN_VALID_GAME_DURATION = 60; // seconds; matches the database check
const MAX_VALID_GAME_DURATION = 604800;

const DEFAULT_VALIDATION_RULES = {
	minLength: 2,
	maxLength: 30,
	pattern: /^[a-zA-Z0-9\s._-]+$/,
	patternMessageKey: 'ui.guestbook.invalidName',
};

const ZH_VALIDATION_RULES = {
	minLength: 2,
	maxLength: 30,
	pattern: /^[\p{L}\p{N}\p{P}\p{S}\p{Zs}]+$/u,
	patternMessageKey: 'ui.guestbook.invalidNameZh',
};

export const NAME_VALIDATION_RULES = DEFAULT_VALIDATION_RULES;

export const getValidationRules = (language) => {
	if (language === 'zh') return ZH_VALIDATION_RULES;
	return DEFAULT_VALIDATION_RULES;
};

const getLanguageSuffix = (language) => {
	if (language === 'zh') return '_zh';
	return '';
};

export const isValidPlayerName = (name, language) => {
	if (!name || typeof name !== 'string') return false;
	const rules = getValidationRules(language);
	const trimmed = name.trim();
	return (
		trimmed.length >= rules.minLength &&
		trimmed.length <= rules.maxLength &&
		rules.pattern.test(trimmed)
	);
};

const isValidGameTime = (startTime, endTime) => {
	if (
		!startTime ||
		!endTime ||
		typeof startTime !== 'number' ||
		typeof endTime !== 'number'
	)
		return false;

	const duration = Math.floor((endTime - startTime) / 1000);
	return (
		duration >= MIN_VALID_GAME_DURATION && duration <= MAX_VALID_GAME_DURATION
	);
};

// Boards mirror the old Firestore collections: 'main' / 'zh', plus '_debug' twins for #debug runs.
const getBoard = (language) => {
	const isDebugMode = window.location.hash.includes('#debug');
	return `${language === 'zh' ? 'zh' : 'main'}${isDebugMode ? DEBUG_SUFFIX : ''}`;
};

const boardFilter = (language) => `board=eq.${getBoard(language)}`;

export const addGuestBookEntry = async (
	playerName,
	startTime,
	endTime,
	deaths = 0,
	language
) => {
	if (!isValidPlayerName(playerName, language)) {
		const rules = getValidationRules(language);
		throw new Error(
			`Invalid player name (${rules.minLength}-${rules.maxLength} characters)`
		);
	}

	if (!isValidGameTime(startTime, endTime)) {
		throw new Error('Invalid game duration');
	}

	try {
		const response = await rest(`${TABLE}?select=id`, {
			method: 'POST',
			prefer: 'return=representation',
			body: {
				board: getBoard(language),
				player_name: playerName.trim(),
				start_time: startTime,
				end_time: endTime,
				deaths,
			},
		});
		const [row] = await response.json();
		return row?.id ?? null;
	} catch (error) {
		console.error('Error adding guestbook entry: ', error);
		throw error;
	}
};

export const getTotalEntries = async (language) => {
	try {
		const response = await rest(`${TABLE}?select=id&${boardFilter(language)}`, {
			prefer: 'count=exact',
			range: '0-0',
		});
		return countFrom(response);
	} catch (error) {
		console.error('Error getting total entries count:', error);
		throw error;
	}
};

export const getTotalPages = async (language) => {
	const totalEntries = await getTotalEntries(language);
	return Math.ceil(totalEntries / PAGE_SIZE);
};

const toEntry = (row) => {
	const completionTimeSeconds = Math.floor((row.end_time - row.start_time) / 1000);
	return {
		id: row.id,
		playerName: row.player_name,
		playerNameLower: row.player_name_lower,
		startTime: row.start_time,
		endTime: row.end_time,
		deaths: row.deaths,
		createdAt: row.created_at,
		completionTimeSeconds,
		formattedTime: formatTime(completionTimeSeconds),
	};
};

// Pages are plain offsets in signing order. `lastVisible` stays an opaque "there was a page" marker
// so the Guest Book component keeps working unchanged.
export const getSpecificPage = async (pageNumber, language) => {
	if (pageNumber < 1) pageNumber = 1;

	try {
		const offset = (pageNumber - 1) * PAGE_SIZE;
		const response = await rest(
			`${TABLE}?select=id,player_name,player_name_lower,start_time,end_time,deaths,created_at&${boardFilter(
				language
			)}&order=created_at.asc,id.asc&offset=${offset}&limit=${PAGE_SIZE}`,
			{ prefer: 'count=exact' }
		);
		const entries = (await response.json()).map(toEntry);
		const totalPages = Math.ceil(countFrom(response) / PAGE_SIZE);

		if (entries.length === 0 && pageNumber > 1) {
			return await getSpecificPage(1, language);
		}

		return {
			entries,
			lastVisible: entries.length > 0 ? { page: pageNumber } : null,
			currentPage: pageNumber,
			totalPages,
		};
	} catch (error) {
		console.error(`Error getting page ${pageNumber}:`, error);
		throw error;
	}
};

export const getFirstGuestBookPage = (language) => getSpecificPage(1, language);

export const getNextGuestBookPage = async (lastVisible, currentPage, language) => {
	if (!lastVisible) {
		return {
			entries: [],
			lastVisible: null,
			currentPage,
			totalPages: currentPage,
		};
	}
	return getSpecificPage(currentPage + 1, language);
};

export const formatTime = (timeInSeconds) => {
	const hours = Math.floor(timeInSeconds / 3600);
	const minutes = Math.floor((timeInSeconds % 3600) / 60);
	const seconds = Math.floor(timeInSeconds % 60);

	return `${hours.toString().padStart(2, '0')}:${minutes
		.toString()
		.padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

// '*' and '%' are wildcards in PostgREST's like filter; names never contain them anyway.
const escapeLike = (term) => term.replace(/[*%]/g, '');

export const findPageByPlayerName = async (playerName, language) => {
	try {
		const searchTerm = playerName.trim().toLowerCase();
		if (!searchTerm) return null;
		const select = `${TABLE}?select=id,created_at&${boardFilter(language)}&limit=1`;

		let response = await rest(
			`${select}&player_name_lower=eq.${encodeURIComponent(searchTerm)}&order=created_at.asc`
		);
		let [match] = await response.json();

		if (!match) {
			const pattern = encodeURIComponent(`*${escapeLike(searchTerm)}*`);
			response = await rest(`${select}&player_name_lower=like.${pattern}&order=player_name_lower.asc`);
			[match] = await response.json();
		}

		if (!match) {
			return null;
		}

		const countResponse = await rest(
			`${TABLE}?select=id&${boardFilter(language)}&created_at=lt.${encodeURIComponent(match.created_at)}`,
			{ prefer: 'count=exact', range: '0-0' }
		);
		const position = countFrom(countResponse);

		return {
			pageNumber: Math.floor(position / PAGE_SIZE) + 1,
			createdAt: match.created_at,
		};
	} catch (error) {
		console.error('Error finding page by player name:', error);
		throw error;
	}
};
