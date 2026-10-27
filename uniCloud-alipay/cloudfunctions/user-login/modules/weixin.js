'use strict';
const createConfig = require('uni-config-center');
const { isNicknameSafe } = require('../common/helpers');
const { issueToken } = require('../common/token');

/* ==================== 微信小程序登录 ==================== */
async function weixinLogin(event, context) {
	const { code, nickname, avatar } = event;

	// 1. 参数校验
	if (!code || !nickname || !avatar) {
		return { errCode: 'PARAM_ILLEGAL', errMsg: '登录参数不完整（code/nickname/avatar）' };
	}
	const safeNickname = String(nickname).trim().slice(0, 20);
	if (!safeNickname) {
		return { errCode: 'NICKNAME_EMPTY', errMsg: '请填写昵称' };
	}
	if (!isNicknameSafe(safeNickname)) {
		return { errCode: 'NICKNAME_INVALID', errMsg: '昵称包含敏感词，请修改' };
	}
	const wxConfig = createConfig({ pluginId: 'user-login' }).config();
	if (!wxConfig.appid || !wxConfig.appsecret || String(wxConfig.appsecret).indexOf('请填写') === 0) {
		return {
			errCode: 'WX_CONFIG_MISSING',
			errMsg: '请先在 uni-config-center/user-login/config.json 中配置微信 appid 与 appsecret'
		};
	}

	// 3. 用 code 请求微信接口换取 openid
	let openid;
	try {
		const httpRes = await uniCloud.httpclient.request(
			'https://api.weixin.qq.com/sns/jscode2session',
			{
				method: 'GET',
				data: {
					appid: wxConfig.appid,
					secret: wxConfig.appsecret,
					js_code: code,
					grant_type: 'authorization_code'
				},
				dataType: 'json',
				timeout: 10000
			}
		);
		const body = httpRes && httpRes.data;
		if (!body || !body.openid) {
			return {
				errCode: 'WX_CODE_INVALID',
				errMsg: (body && body.errmsg) || '微信登录凭证校验失败',
				raw: body || null
			};
		}
		openid = body.openid;
	} catch (e) {
		return { errCode: 'WX_REQUEST_FAIL', errMsg: '请求微信服务器失败：' + (e && e.message) };
	}

	// 4. 按 openid 查询用户，不存在则创建，存在则更新头像昵称
	const db = uniCloud.database();
	const userCol = db.collection('uni-id-users');
	const now = Date.now();
	let uid;
	let isAdmin = 0;

	const existed = await userCol.where({ wx_openid: openid }).limit(1).get();
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
			wx_openid: openid,
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

module.exports = { weixinLogin };
