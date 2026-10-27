'use strict';
const { isNicknameSafe, isValidAvatar } = require('../common/helpers');
const { issueToken } = require('../common/token');

/* ==================== App 游客式登录（昵称 + 头像，无手机号/无微信） ==================== */
async function guestLogin(event, context) {
	const { nickname, avatar } = event;
	const guestId = String(event.guestId || '').trim();

	const safeNickname = String(nickname || '').trim().slice(0, 20);
	if (!safeNickname) {
		return { errCode: 'NICKNAME_EMPTY', errMsg: '请填写昵称' };
	}
	if (!isNicknameSafe(safeNickname)) {
		return { errCode: 'NICKNAME_INVALID', errMsg: '昵称包含敏感词，请修改' };
	}
	if (!isValidAvatar(avatar)) {
		return { errCode: 'AVATAR_INVALID', errMsg: '头像不合法' };
	}

	const db = uniCloud.database();
	const userCol = db.collection('uni-id-users');
	const now = Date.now();

	// 1. 带合法 guest_id 的老设备：更新资料后直接登录（token 过期重登时不重建账号）
	let uid = '';
	let isAdmin = 0;
	let finalGuestId = /^g_[A-Za-z0-9_-]{6,64}$/.test(guestId) ? guestId : '';
	if (finalGuestId) {
		const existed = await userCol.where({ guest_id: finalGuestId }).limit(1).get();
		if (existed.data && existed.data.length) {
			uid = existed.data[0]._id;
			isAdmin = existed.data[0].is_admin || 0;
			await userCol.doc(uid).update({
				nickname: safeNickname,
				avatar,
				last_login_date: now
			});
		}
	}

	// 2. 新设备：生成服务端 guest_id 并建档
	if (!uid) {
		finalGuestId = 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
		const addRes = await userCol.add({
			guest_id: finalGuestId,
			nickname: safeNickname,
			avatar,
			register_date: now,
			last_login_date: now,
			status: 0,
			is_admin: 0
		});
		uid = addRes.id;
	}

	const res = await issueToken({ uid, nickname: safeNickname, avatar, isAdmin }, context);
	if (res.errCode === 0) res.guestId = finalGuestId;
	return res;
}

module.exports = { guestLogin };
