'use strict';
const uniIdCommon = require('uni-id-common');

/* ==================== 保存 uniPush 客户端标识 ==================== */
async function savePushCid(event, context) {
	const token =
		(context && context.UNI_ID_TOKEN) ||
		(context && context.clientInfo && context.clientInfo.uniIdToken) ||
		(event && event.uniIdToken) ||
		'';
	if (!token) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };

	const uniIdInstance = uniIdCommon.createInstance({
		clientInfo: (context && context.clientInfo) || {}
	});
	const checkRes = await uniIdInstance.checkToken(token);
	if (checkRes.errCode || !checkRes.uid) {
		return { errCode: 'LOGIN_REQUIRED', errMsg: '登录态已过期，请重新登录' };
	}

	const cid = String(event.cid || '').trim();
	if (!cid || cid.length > 128) {
		return { errCode: 'PARAM_ILLEGAL', errMsg: 'push cid 无效' };
	}

	await uniCloud
		.database()
		.collection('uni-id-users')
		.doc(checkRes.uid)
		.update({ push_cid: cid, push_cid_time: Date.now() });
	return { errCode: 0 };
}

module.exports = { savePushCid };
