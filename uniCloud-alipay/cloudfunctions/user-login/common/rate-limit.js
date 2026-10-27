'use strict';

// 迁移码恢复限流：按 IP 每分钟最多 5 次，防暴力破解
const migrateRateMap = new Map();
function checkMigrateRate(ip) {
	const key = 'migrate:' + ip;
	const now = Date.now();
	const WINDOW = 60 * 1000;
	const MAX = 5;
	let entry = migrateRateMap.get(key);
	if (!entry || now - entry.windowStart >= WINDOW) {
		migrateRateMap.set(key, { count: 1, windowStart: now });
		return true;
	}
	if (entry.count >= MAX) return false;
	entry.count++;
	return true;
}

module.exports = { checkMigrateRate };
