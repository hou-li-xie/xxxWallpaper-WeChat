'use strict';
const { genMigrateCode, getUidFromContext } = require('../common/helpers');
const { checkMigrateRate } = require('../common/rate-limit');
const { issueToken } = require('../common/token');

/* ==================== 账号迁移码（App 游客账号换机/重装恢复） ==================== */

// 获取（首次自动生成）当前账号迁移码 —— 需登录
async function getMigrateCode(event, context) {
	const uid = await getUidFromContext(context, event);
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };

	const db = uniCloud.database();
	const userCol = db.collection('uni-id-users');
	const uRes = await userCol.doc(uid).get();
	const user = uRes.data && uRes.data[0];
	if (!user) return { errCode: 'USER_NOT_FOUND', errMsg: '账号不存在' };
	if (!user.guest_id) return { errCode: 'NOT_SUPPORTED', errMsg: '当前账号类型不支持迁移码' };

	if (user.migrate_code) {
		return { errCode: 0, migrateCode: user.migrate_code, createTime: user.migrate_code_time || 0 };
	}

	// 生成并防极小概率碰撞
	let code = genMigrateCode();
	for (let i = 0; i < 3; i++) {
		const dup = await userCol.where({ migrate_code: code }).count();
		if (!dup.total) break;
		code = genMigrateCode();
	}
	const now = Date.now();
	await userCol.doc(uid).update({ migrate_code: code, migrate_code_time: now });
	return { errCode: 0, migrateCode: code, createTime: now };
}

// 重新生成迁移码（旧码立即失效）—— 需登录
async function resetMigrateCode(event, context) {
	const uid = await getUidFromContext(context, event);
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };

	const db = uniCloud.database();
	const userCol = db.collection('uni-id-users');
	let code = genMigrateCode();
	for (let i = 0; i < 3; i++) {
		const dup = await userCol.where({ migrate_code: code }).count();
		if (!dup.total) break;
		code = genMigrateCode();
	}
	const now = Date.now();
	await userCol.doc(uid).update({ migrate_code: code, migrate_code_time: now });
	return { errCode: 0, migrateCode: code, createTime: now };
}

// 凭迁移码在新设备恢复登录：无需登录态；若新设备临时账号已发过照片则拒绝（不支持合并）
async function migrateByCode(event, context) {
	const code = String(event.code || '').trim().toUpperCase();
	if (!/^[A-Z0-9]{8}$/.test(code)) {
		return { errCode: 'CODE_INVALID', errMsg: '迁移码为 8 位字符' };
	}

	// 按 IP 限流：每分钟最多 5 次，防暴力破解迁移码
	const ip = (context && context.CLIENTIP) || (context && context.clientInfo && context.clientInfo.clientIP) || 'unknown';
	if (!checkMigrateRate(ip)) {
		return { errCode: 'RATE_LIMITED', errMsg: '尝试过于频繁，请 1 分钟后再试' };
	}

	const db = uniCloud.database();
	const userCol = db.collection('uni-id-users');
	const tRes = await userCol.where({ migrate_code: code }).limit(1).get();
	const target = tRes.data && tRes.data[0];
	if (!target) {
		return { errCode: 'CODE_NOT_FOUND', errMsg: '迁移码无效，请核对后重试' };
	}
	if (target.status === 1) {
		return { errCode: 'USER_BANNED', errMsg: '该账号已被封禁，无法恢复' };
	}

	// 新设备上可能已随手注册了一个临时游客账号：未发布过内容则清理，已发布则拒绝合并
	const tempUid = await getUidFromContext(context, event);
	if (tempUid && tempUid !== target._id) {
		const photoCount = await db
			.collection('wallpapers')
			.where({ author_id: tempUid })
			.count();
		if (photoCount.total > 0) {
			return {
				errCode: 'TEMP_HAS_CONTENT',
				errMsg: '本机已登录的账号发布过照片，账号数据不支持合并，请直接卸载重装后再恢复'
			};
		}
		// 空账号：删主记录及其点赞/收藏残留
		try {
			await db.collection('wallpaper_likes').where({ user_id: tempUid }).remove();
			await db.collection('wallpaper_favorites').where({ user_id: tempUid }).remove();
			await userCol.doc(tempUid).remove();
		} catch (e) {
			// 清理失败不阻断恢复
			console.error('[user-login] 临时账号清理失败', e);
		}
	}

	await userCol.doc(target._id).update({ last_login_date: Date.now() });

	const res = await issueToken(
		{ uid: target._id, nickname: target.nickname, avatar: target.avatar, isAdmin: target.is_admin || 0 },
		context
	);
	if (res.errCode === 0) res.guestId = target.guest_id;
	return res;
}

module.exports = { getMigrateCode, resetMigrateCode, migrateByCode };
