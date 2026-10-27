'use strict';
const createConfig = require('uni-config-center');
const uniIdCommon = require('uni-id-common');

/**
 * 微信小程序登录云函数
 *
 * 入参 event:
 * @param {string} code     uni.login() 返回的临时登录凭证
 * @param {string} nickname 用户填写/选择的微信昵称
 * @param {string} avatar   头像已上传到云存储后返回的 fileID
 *
 * 流程：code 换 openid -> 查询/创建用户 -> uni-id-common 签发 token
 */
exports.main = async (event, context) => {
	const { code, nickname, avatar } = event;

	// 1. 参数校验
	if (!code || !nickname || !avatar) {
		return { errCode: 'PARAM_ILLEGAL', errMsg: '登录参数不完整（code/nickname/avatar）' };
	}
	const safeNickname = String(nickname).trim().slice(0, 20);
	if (!safeNickname) {
		return { errCode: 'NICKNAME_EMPTY', errMsg: '请填写昵称' };
	}

	// 2. 读取微信小程序配置（uni-config-center/user-login/config.json）
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

	const existed = await userCol.where({ wx_openid: openid }).limit(1).get();
	let isAdmin = 0;
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

	// 5. 用 uni-id-common 签发 token（前端存入 uni_id_token，clientDB 会自动携带）
	const uniIdCommonInstance = uniIdCommon.createInstance({
		clientInfo: (context && context.clientInfo) || {}
	});
	const tokenRes = await uniIdCommonInstance.createToken({
		uid,
		role: [],
		permission: []
	});
	if (tokenRes.errCode) {
		return tokenRes;
	}

	return {
		errCode: 0,
		errMsg: '登录成功',
		uid,
		token: tokenRes.token,
		tokenExpired: tokenRes.tokenExpired,
		userInfo: {
			_id: uid,
			nickname: safeNickname,
			avatar,
			is_admin: isAdmin
		}
	};
};
