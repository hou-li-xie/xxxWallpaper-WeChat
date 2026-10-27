'use strict';
const { requireActiveUser } = require('../common/auth');
const { checkRateLimit } = require('../common/rate-limit');

/* ========== 用户主页：用户信息 + TA 已过审照片分页 ========== */
async function userHome(ctx) {
	const { wallpaperCol, userCol, event } = ctx;
	const { targetUid, skip = 0 } = event;
	if (!targetUid) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少用户ID' };
	const uRes = await userCol.doc(targetUid).field({ nickname: 1, avatar: 1, last_active_time: 1 }).get();
	const user = uRes.data && uRes.data[0];
	if (!user) return { errCode: 'NOT_FOUND', errMsg: '用户不存在' };

	const LIMIT = 20;
	const listRes = await wallpaperCol
		.where({ author_id: targetUid, audit_status: 1 })
		.orderBy('createTime', 'desc')
		.skip(skip)
		.limit(LIMIT)
		.get();
	const countRes = await wallpaperCol
		.where({ author_id: targetUid, audit_status: 1 })
		.count();
	const list = listRes.data || [];
	return {
		errCode: 0,
		user: { _id: targetUid, nickname: user.nickname || '用户', avatar: user.avatar || '', last_active_time: user.last_active_time || 0 },
		list,
		hasMore: list.length === LIMIT,
		photoCount: countRes.total || 0
	};
}

/* ========== 心跳：更新当前用户最后活跃时间，用于在线判定 ========== */
async function heartbeat(ctx) {
	const { userCol, uid, event } = ctx;
	const { online = true } = event;
	if (!uid) return { errCode: 0 };
	// online=false → 清零标记下线；否则更新当前时间戳
	const ts = online === false ? 0 : Date.now();
	await userCol.doc(uid).update({ last_active_time: ts });
	return { errCode: 0 };
}

/* ========== 用户举报：同一人对同一照片仅有1条待处理举报 ========== */
async function report(ctx) {
	const { wallpaperCol, reportCol, userCol, uid, event } = ctx;
	const { id, reason } = event;
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录后再举报' };
	const banned = await requireActiveUser(userCol, uid);
	if (banned) return banned;
	if (!id) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少照片ID' };
	if (!checkRateLimit('report', uid)) {
		return { errCode: 'RATE_LIMITED', errMsg: '举报过于频繁，请稍后再试' };
	}

	const text = String(reason == null ? '' : reason).trim();
	if (!text) return { errCode: 'PARAM_ILLEGAL', errMsg: '请选择或填写举报原因' };
	if (text.length > 100) return { errCode: 'PARAM_ILLEGAL', errMsg: '举报原因最多100字' };

	const wpRes = await wallpaperCol.doc(id).get();
	const wallpaper = wpRes.data && wpRes.data[0];
	if (!wallpaper) return { errCode: 'NOT_FOUND', errMsg: '照片不存在或已删除' };

	// 防重复：同一举报人对同一照片已有待处理举报时不再新建
	const dup = await reportCol
		.where({ wallpaper_id: id, reporter_id: uid, status: 0 })
		.count();
	if (dup.total) {
		return { errCode: 'REPORT_DUPLICATED', errMsg: '你已举报过该照片，请等待处理' };
	}

	await reportCol.add({
		wallpaper_id: id,
		reporter_id: uid,
		reason: text,
		status: 0,
		create_time: Date.now()
	});
	return { errCode: 0 };
}

module.exports = { userHome, heartbeat, report };
