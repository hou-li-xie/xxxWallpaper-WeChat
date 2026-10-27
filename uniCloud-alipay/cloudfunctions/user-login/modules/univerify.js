'use strict';
const { issueToken } = require('../common/token');

/* ==================== App 本机号码一键登录（univerify，已弃用保留） ==================== */
async function univerifyLogin(event, context) {
	const { access_token, openid, nickname, avatar } = event;
	if (!access_token || !openid || !nickname || !avatar) {
		return { errCode: 'PARAM_ILLEGAL', errMsg: '登录参数不完整（access_token/openid/nickname/avatar）' };
	}
	const safeNickname = String(nickname).trim().slice(0, 20);
	if (!safeNickname) {
		return { errCode: 'NICKNAME_EMPTY', errMsg: '请填写昵称' };
	}

	// 1. 服务端用 access_token/openid 换真实手机号
	let mobile;
	try {
		const univerifyManager = uniCloud.getUniverifyManager();
		const phoneRes = await univerifyManager.getPhoneNumber({
			access_token: String(access_token),
			openid: String(openid)
		});
		if (!phoneRes || phoneRes.code !== 0 || !phoneRes.data || !phoneRes.data.mobile) {
			return {
				errCode: 'UNIVERIFY_FAIL',
				errMsg: (phoneRes && (phoneRes.msg || phoneRes.errMsg)) || '一键登录校验失败',
				raw: phoneRes || null
			};
		}
		mobile = phoneRes.data.mobile;
	} catch (e) {
		return { errCode: 'UNIVERIFY_REQUEST_FAIL', errMsg: '一键登录服务请求失败：' + (e && e.message) };
	}

	// 2. 按手机号查用户，不存在则创建，存在则更新头像昵称
	const db = uniCloud.database();
	const userCol = db.collection('uni-id-users');
	const now = Date.now();
	let uid;
	let isAdmin = 0;

	const existed = await userCol.where({ mobile }).limit(1).get();
	if (existed.data && existed.data.length) {
		uid = existed.data[0]._id;
		isAdmin = existed.data[0].is_admin || 0;
		await userCol.doc(uid).update({
			nickname: safeNickname,
			avatar,
			last_login_date: now
		});
	} else {
		const addRes = await userCol.add({
			mobile,
			nickname: safeNickname,
			avatar,
			register_date: now,
			last_login_date: now,
			status: 0,
			is_admin: 0
		});
		uid = addRes.id;
	}

	return issueToken({ uid, nickname: safeNickname, avatar, isAdmin }, context);
}

module.exports = { univerifyLogin };
