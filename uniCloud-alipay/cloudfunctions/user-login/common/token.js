'use strict';
const uniIdCommon = require('uni-id-common');

/* ==================== 公共：uni-id-common 签发 token ==================== */
async function issueToken({ uid, nickname, avatar, isAdmin }, context) {
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
			nickname,
			avatar,
			is_admin: isAdmin
		}
	};
}

module.exports = { issueToken };
