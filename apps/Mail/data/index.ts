import defaults from './defaults.json';

const settings = (defaults.settings ?? {}) as Record<string, boolean>;

export const MAIL_CONFIG = { settings };
