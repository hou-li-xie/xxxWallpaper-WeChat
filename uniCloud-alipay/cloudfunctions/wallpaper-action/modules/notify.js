'use strict';
const { getWxConfig } = require('../common/wx');

/* ========== 我的站内通知列表 ========== */
async function notifications(ctx) {
	const { notiCol, uid, event } = ctx;
	const { skip = 0 } = event;
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
	const LIMIT = 20;
	const listRes = await notiCol
		.where({ user_id: uid })
		.orderBy('create_time', 'desc')
		.skip(skip)
		.limit(LIMIT)
		.get();
	return { errCode: 0, list: listRes.data || [], hasMore: (listRes.data || []).length === LIMIT };
}

/* ========== 我的未读通知数 ========== */
async function unreadCount(ctx) {
	const { notiCol, uid } = ctx;
	if (!uid) return { errCode: 0, count: 0 };
	const countRes = await notiCol.where({ user_id: uid, is_read: 0 }).count();
	return { errCode: 0, count: countRes.total || 0 };
}

/* ========== 标记单条通知已读 ========== */
async function markRead(ctx) {
	const { notiCol, uid, event } = ctx;
	const { notiId } = event;
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
	if (!notiId) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少通知ID' };
	// 带 user_id 条件，越权改不到别人的通知
	await notiCol
		.where({ _id: String(notiId), user_id: uid, is_read: 0 })
		.update({ is_read: 1 });
	return { errCode: 0 };
}

/* ========== 全部已读 ========== */
async function markAllRead(ctx) {
	const { notiCol, uid } = ctx;
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
	await notiCol.where({ user_id: uid, is_read: 0 }).update({ is_read: 1 });
	return { errCode: 0 };
}

/* ========== 删除单条通知（消息页左滑删除） ========== */
async function deleteNotification(ctx) {
	const { notiCol, uid, event } = ctx;
	const { notiId } = event;
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
	if (!notiId) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少通知ID' };
	// 带 user_id 条件，越权删不到别人的通知
	await notiCol.where({ _id: String(notiId), user_id: uid }).remove();
	return { errCode: 0 };
}

/* ========== 订阅消息配置（模板ID + 当前剩余下发条数，由服务端统一下发） ========== */
async function subscribeInfo(ctx) {
	const { subCol, uid } = ctx;
	const cfg = getWxConfig();
	let remain = 0;
	let auditRemain = 0;
	if (uid) {
		if (cfg.replyTemplateId) {
			const subR = await subCol
				.where({ user_id: uid, tmpl_id: cfg.replyTemplateId })
				.limit(1)
				.get();
			remain = (subR.data && subR.data[0] && subR.data[0].remain) || 0;
		}
		if (cfg.auditTemplateId) {
			const subA = await subCol
				.where({ user_id: uid, tmpl_id: cfg.auditTemplateId })
				.limit(1)
				.get();
			auditRemain = (subA.data && subA.data[0] && subA.data[0].remain) || 0;
		}
	}
	return {
		errCode: 0,
		templateId: cfg.replyTemplateId,
		remain,
		auditTemplateId: cfg.auditTemplateId,
		auditRemain
	};
}

/* ========== 微信一次性订阅授权：增加下发额度（tmplType=reply 默认 / audit 审核通知） ========== */
async function saveSubscribe(ctx) {
	const { subCol, uid, event } = ctx;
	const { tmplType = '' } = event;
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
	const cfg = getWxConfig();
	const tmplId = tmplType === 'audit' ? cfg.auditTemplateId : cfg.replyTemplateId;
	if (!tmplId) {
		return { errCode: 'TEMPLATE_NOT_CONFIGURED', errMsg: '订阅模板未配置' };
	}
	const now = Date.now();
	const existed = await subCol
		.where({ user_id: uid, tmpl_id: tmplId })
		.limit(1)
		.get();
	let latestRemain;
	if (existed.data && existed.data.length) {
		latestRemain = (existed.data[0].remain || 0) + 1;
		await subCol.doc(existed.data[0]._id).update({
			remain: latestRemain,
			update_time: now
		});
	} else {
		latestRemain = 1;
		await subCol.add({
			user_id: uid,
			tmpl_id: tmplId,
			remain: 1,
			update_time: now
		});
	}
	return { errCode: 0, remain: latestRemain };
}

module.exports = { notifications, unreadCount, markRead, markAllRead, deleteNotification, subscribeInfo, saveSubscribe };
