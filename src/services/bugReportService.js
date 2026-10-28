import { rest } from './supabase';

export const addBugReport = async (description, consoleLogs, deviceInfo) => {
	try {
		await rest('cleaning_bug_reports', {
			method: 'POST',
			prefer: 'return=minimal',
			body: {
				description,
				console_logs: consoleLogs,
				device_info: deviceInfo,
			},
		});
		return true;
	} catch (error) {
		console.error('Error adding bug report: ', error);
		throw error;
	}
};
