/**
 * 时间格式化工具：各页面共用，避免每个页面重复实现一份。
 * 统一接受毫秒时间戳（数字或字符串），空值返回空串。
 */

const pad = (n: number): string => String(n).padStart(2, '0');

function toDate(ts?: number | string): Date | null {
	if (ts === undefined || ts === null || ts === '') return null;
	const value = Number(ts);
	if (!Number.isFinite(value)) return null;
	return new Date(value);
}

/**
 * 相对时间：1 分钟内「刚刚」，1 小时内按分钟，1 天内按小时，
 * 7 天内按天，更早则显示 YYYY-MM-DD。
 */
export function formatTime(ts?: number | string): string {
	const d = toDate(ts);
	if (!d) return '';
	const diff = Date.now() - d.getTime();
	const min = 60 * 1000;
	const hour = 60 * min;
	const day = 24 * hour;
	if (diff < min) return '刚刚';
	if (diff < hour) return Math.floor(diff / min) + '分钟前';
	if (diff < day) return Math.floor(diff / hour) + '小时前';
	if (diff < 7 * day) return Math.floor(diff / day) + '天前';
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 完整日期时间：YYYY-MM-DD HH:mm */
export function formatDateTime(ts?: number | string): string {
	const d = toDate(ts);
	if (!d) return '';
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 日期：YYYY-MM-DD */
export function formatDate(ts?: number | string): string {
	const d = toDate(ts);
	if (!d) return '';
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
