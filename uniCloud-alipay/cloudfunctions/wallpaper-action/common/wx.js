'use strict';
const createConfig = require('uni-config-center');

// 微信 access_token 进程级缓存（实例复用时有效，过期自动重取）
const wxTokenCache = { token: '', expire: 0 };

/**
 * 读取 wallpaper-action 配置（uni-config-center/wallpaper-action/config.json）
 * 微信 appid/appsecret 复用 user-login 的配置
 */
function getWxConfig() {
	const actionCfg = createConfig({ pluginId: 'wallpaper-action' }).config() || {};
	let loginCfg = {};
	try {
		loginCfg = createConfig({ pluginId: 'user-login' }).config() || {};
	} catch (e) {
		loginCfg = {};
	}
	return {
		appid: loginCfg.appid || '',
		appsecret: loginCfg.appsecret || '',
		replyTemplateId: (actionCfg.wx && actionCfg.wx.replyTemplateId) || '',
		auditTemplateId: (actionCfg.wx && actionCfg.wx.auditTemplateId) || '',
		miniState: (actionCfg.wx && actionCfg.wx.miniState) || 'developer',
		page: (actionCfg.wx && actionCfg.wx.page) || 'pages/Home/index'
	};
}

/**
 * 读取 App 配置（config.json 的 app 节点）
 * appId=DCloud appid（uniPush 必需）；versionCode/wgtUrl/apkUrl/updateNotes 用于客户端热更新检测
 */
function getAppConfig() {
	try {
		const cfg = createConfig({ pluginId: 'wallpaper-action' }).config() || {};
		return cfg.app || {};
	} catch (e) {
		return {};
	}
}

/**
 * 给 App 用户推 uniPush 通知（用户表存有 push_cid 才推，不占微信订阅额度）
 * uniPush 2.0 未开通/未绑定时 pushMessage 会抛错，由调用方容错
 */
async function pushToAppUser(user, { title, content, payload }) {
	if (!user || !user.push_cid) return false;
	const appCfg = getAppConfig();
	if (!appCfg.appId) return false;
	await uniCloud.getPushManager({ appId: appCfg.appId }).pushMessage({
		pushClientId: user.push_cid,
		title: String(title || '').slice(0, 20),
		content: String(content || '').slice(0, 100),
		payload: payload || {}
	});
	return true;
}

async function getWxAccessToken() {
	if (wxTokenCache.token && wxTokenCache.expire > Date.now()) {
		return wxTokenCache.token;
	}
	const cfg = getWxConfig();
	const httpRes = await uniCloud.httpclient.request(
		'https://api.weixin.qq.com/cgi-bin/token',
		{
			method: 'GET',
			data: {
				grant_type: 'client_credential',
				appid: cfg.appid,
				secret: cfg.appsecret
			},
			dataType: 'json',
			timeout: 10000
		}
	);
	const body = httpRes && httpRes.data;
	if (!body || !body.access_token) {
		throw new Error((body && body.errmsg) || '获取access_token失败');
	}
	wxTokenCache.token = body.access_token;
	wxTokenCache.expire = Date.now() + (Number(body.expires_in) - 300) * 1000;
	return body.access_token;
}

function pad2(n) {
	return String(n).padStart(2, '0');
}

function formatTmplTime(ts) {
	const d = new Date(ts);
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 给被回复人下发一条微信「一次性订阅消息」
 * 前置：接收人有剩余额度（remain>0，每次授权+1）
 * 注意：模板字段名需与公众平台申请的模板一致，如不一致请按实际模板调整下方 data。
 */
async function sendReplySubscribe(db, dbCmd, noti) {
	const cfg = getWxConfig();
	if (!cfg.replyTemplateId) return; // 未配置模板，仅保留站内通知
	if (!cfg.appid || !cfg.appsecret) return;

	const subRes = await db
		.collection('wallpaper_subscribes')
		.where({ user_id: noti.user_id, tmpl_id: cfg.replyTemplateId })
		.limit(1)
		.get();
	const sub = subRes.data && subRes.data[0];
	if (!sub || !sub.remain || sub.remain <= 0) return;

	// 取接收人 openid
	const userRes = await db.collection('uni-id-users').doc(noti.user_id).get();
	const targetUser = userRes.data && userRes.data[0];
	const openid = targetUser && targetUser.wx_openid;
	if (!openid) return;

	const accessToken = await getWxAccessToken();
	// thing 类型内容最长 20 个字符
	const thing = (s) => String(s || '').slice(0, 20);
	const postBody = {
		touser: openid,
		template_id: cfg.replyTemplateId,
		page: cfg.page,
		miniprogram_state: cfg.miniState,
		lang: 'zh_CN',
		data: {
			thing1: { value: thing(noti.from && noti.from.name) || '用户' },
			thing2: { value: thing(noti.content) },
			time3: { value: formatTmplTime(noti.create_time) }
		}
	};

	const httpRes = await uniCloud.httpclient.request(
		'https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=' + encodeURIComponent(accessToken),
		{
			method: 'POST',
			contentType: 'json',
			data: postBody,
			dataType: 'json',
			timeout: 10000
		}
	);
	const body = httpRes && httpRes.data;
	const errcode = body ? body.errcode : -1;

	if (errcode === 0) {
		// 下发成功，消耗一次额度
		await db
			.collection('wallpaper_subscribes')
			.doc(sub._id)
			.update({ remain: dbCmd.inc(-1), update_time: Date.now() });
	} else if (errcode === 43101 || errcode === 40003) {
		// 43101: 用户未订阅/额度已尽；40003: openid 无效 —— 额度清零避免无效重试
		await db
			.collection('wallpaper_subscribes')
			.doc(sub._id)
			.update({ remain: 0, update_time: Date.now() });
	} else {
		console.error('[wallpaper-action] subscribe/send 失败', body);
	}
}

/**
 * 给作者下发「审核结果」微信订阅消息（通过/驳回）
 * 额度体系与评论回复通知共用 wallpaper_subscribes（tmpl_id 不同，互不干扰）
 * 模板字段（公共模板库「审核结果通知」：审核结果/审核时间/备注）：
 *   phrase1=审核结果  time2=审核时间  thing3=备注
 * 若 47003 报错，按公众平台模板详情页的实际字段名调整下方 data。
 */
async function sendAuditSubscribe(db, dbCmd, uid, { description, passed, reason }) {
	// App 端 uniPush 直推（不依赖微信配置，不占订阅额度；用户表存有 push_cid 才推）
	try {
		const appUserRes = await db.collection('uni-id-users').doc(uid).get();
		const appUser = appUserRes.data && appUserRes.data[0];
		if (appUser) {
			await pushToAppUser(appUser, {
				title: passed ? '审核通过' : '审核未通过',
				content: passed ? '你发布的照片已通过审核并公开展示' : '驳回原因：' + String(reason || '请查看详情'),
				payload: { type: 'audit', target: 'pages/MyUploads/my-uploads' }
			});
		}
	} catch (e) {
		console.error('[wallpaper-action] audit uniPush 失败（不影响订阅消息）', e && e.message);
	}

	const cfg = getWxConfig();
	if (!cfg.auditTemplateId) {
		console.error('[wallpaper-action] audit 订阅跳过：未配置 wx.auditTemplateId');
		return;
	}
	if (!cfg.appid || !cfg.appsecret) {
		console.error('[wallpaper-action] audit 订阅跳过：缺少 appid/appsecret');
		return;
	}

	const subRes = await db
		.collection('wallpaper_subscribes')
		.where({ user_id: uid, tmpl_id: cfg.auditTemplateId })
		.limit(1)
		.get();
	const sub = subRes.data && subRes.data[0];
	if (!sub || !sub.remain || sub.remain <= 0) {
		console.error('[wallpaper-action] audit 订阅跳过：用户无下发额度 uid=' + uid);
		return;
	}

	const userRes = await db.collection('uni-id-users').doc(uid).get();
	const targetUser = userRes.data && userRes.data[0];
	const openid = targetUser && targetUser.wx_openid;
	if (!openid) {
		console.error('[wallpaper-action] audit 订阅跳过：用户无 wx_openid uid=' + uid);
		return;
	}

	const accessToken = await getWxAccessToken();
	const thing = (s) => String(s || '').slice(0, 20);
	const postBody = {
		touser: openid,
		template_id: cfg.auditTemplateId,
		page: 'pages/MyUploads/my-uploads',
		miniprogram_state: cfg.miniState,
		lang: 'zh_CN',
		data: {
			phrase1: { value: passed ? '审核通过' : '审核不通过' },
			time2: { value: formatTmplTime(Date.now()) },
			thing3: { value: thing(passed ? '已公开展示' : reason || '请查看详情') }
		}
	};

	const httpRes = await uniCloud.httpclient.request(
		'https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=' + encodeURIComponent(accessToken),
		{
			method: 'POST',
			contentType: 'json',
			data: postBody,
			dataType: 'json',
			timeout: 10000
		}
	);
	const body = httpRes && httpRes.data;
	const errcode = body ? body.errcode : -1;

	if (errcode === 0) {
		await db
			.collection('wallpaper_subscribes')
			.doc(sub._id)
			.update({ remain: dbCmd.inc(-1), update_time: Date.now() });
	} else if (errcode === 43101 || errcode === 40003) {
		await db
			.collection('wallpaper_subscribes')
			.doc(sub._id)
			.update({ remain: 0, update_time: Date.now() });
	} else {
		console.error('[wallpaper-action] audit subscribe/send 失败', body);
	}
}

module.exports = { getWxConfig, getAppConfig, getWxAccessToken, pushToAppUser, sendReplySubscribe, sendAuditSubscribe };
