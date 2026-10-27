'use strict';
const uniIdCommon = require('uni-id-common');

// 迁移码字符集：去掉易混淆的 0/O、1/I/L
const MIGRATE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function genMigrateCode() {
	let s = '';
	for (let i = 0; i < 8; i++) {
		s += MIGRATE_CHARS.charAt(Math.floor(Math.random() * MIGRATE_CHARS.length));
	}
	return s;
}

// 从调用上下文解析已登录 uid（token 无效/缺失返回空串）
async function getUidFromContext(context, event) {
	const token =
		(context && context.UNI_ID_TOKEN) ||
		(context && context.clientInfo && context.clientInfo.uniIdToken) ||
		(event && event.uniIdToken) ||
		'';
	if (!token) return '';
	try {
		const inst = uniIdCommon.createInstance({
			clientInfo: (context && context.clientInfo) || {}
		});
		const r = await inst.checkToken(token);
		return !r.errCode && r.uid ? r.uid : '';
	} catch (e) {
		return '';
	}
}

// 默认头像白名单：只允许包内内置 6 张，或云存储 fileID，防止写入任意字符串
const DEFAULT_AVATAR_RE = /^\/static\/avatars\/a[1-6]\.png$/;
function isValidAvatar(avatar) {
	return typeof avatar === 'string' && avatar.length <= 300 &&
		(DEFAULT_AVATAR_RE.test(avatar) || avatar.indexOf('cloud://') === 0);
}

// 昵称敏感词兜底过滤（微信端走 msgSecCheck，游客端用本地词表）
const NICKNAME_SENSITIVE = ['色情', '赌博', '毒品', '枪支', '暴力', '恐怖', '反动', '分裂', '诈骗', '博彩'];
function isNicknameSafe(name) {
	for (let i = 0; i < NICKNAME_SENSITIVE.length; i++) {
		if (name.indexOf(NICKNAME_SENSITIVE[i]) !== -1) return false;
	}
	return true;
}

module.exports = { genMigrateCode, getUidFromContext, isValidAvatar, isNicknameSafe };
