'use strict';

// ===== 轻量级限流（进程内内存 + 滑动时间窗，实例复用时有效） =====
// key -> { count, windowStart }
const rateLimitMap = new Map();
// 各 action 限流规则：[窗口毫秒, 最大次数]
const RATE_LIMIT_RULES = {
	recordView: [10000, 1],        // 单照片浏览量：10 秒内最多 1 次（按 uid+id）
	search: [60000, 10],           // 搜索：每分钟最多 10 次（按调用方）
	searchUsers: [60000, 10],      // 用户搜索：每分钟最多 10 次
	report: [60000, 5]             // 举报：每分钟最多 5 次（按 uid）
};

/**
 * 限流检查
 * @param {string} action 动作名
 * @param {string} caller 调用方标识（uid / ip / uid+id 等）
 * @returns {boolean} true=放行 false=触发限流
 */
function checkRateLimit(action, caller) {
	const rule = RATE_LIMIT_RULES[action];
	if (!rule) return true;
	const [windowMs, max] = rule;
	const key = action + ':' + caller;
	const now = Date.now();
	let entry = rateLimitMap.get(key);
	if (!entry || now - entry.windowStart >= windowMs) {
		rateLimitMap.set(key, { count: 1, windowStart: now });
		return true;
	}
	if (entry.count >= max) return false;
	entry.count++;
	return true;
}

module.exports = { checkRateLimit };
