'use strict';
const { getWxConfig, getWxAccessToken } = require('./wx');

// 服务端敏感词兜底：游客（无 wx_openid）无法走微信 msgSecCheck，用本地词表做基础过滤
// 词表可按需扩展；命中即判为不通过
const SENSITIVE_WORDS = [
	'色情', '赌博', '毒品', '枪支', '暴力', '恐怖', '反动', '分裂',
	'诈骗', '刷单', '博彩', '卖淫', '嫖娼', '迷药', '枪支弹药',
	'法轮功', '六四', '习近平', '共产党'
];

function localTextRiskCheck(content) {
	const text = String(content || '');
	for (let i = 0; i < SENSITIVE_WORDS.length; i++) {
		if (text.indexOf(SENSITIVE_WORDS[i]) !== -1) {
			return { pass: false, hit: SENSITIVE_WORDS[i] };
		}
	}
	return { pass: true };
}

/**
 * 文本内容安全检测
 * - 所有用户先走本地敏感词兜底（覆盖游客无 openid 的场景）
 * - 微信用户（有 openid 且配置完整）再叠加 msgSecCheck 云端检测
 * scene: 1资料 2评论 3论坛 4日志
 * @returns {{pass:boolean}} suggest=pass 才放行；接口本身异常时抛错由调用方容错
 */
async function checkTextRisk(openid, content) {
	// 1. 本地敏感词兜底（游客/微信用户均执行）
	const local = localTextRiskCheck(content);
	if (!local.pass) return { pass: false, reason: '命中敏感词' };

	// 2. 无 openid 或微信配置缺失时，仅依赖本地检测结果
	const cfg = getWxConfig();
	if (!cfg.appid || !cfg.appsecret || !openid) return { pass: true };

	// 3. 微信用户走 msgSecCheck 云端检测
	const accessToken = await getWxAccessToken();
	const httpRes = await uniCloud.httpclient.request(
		'https://api.weixin.qq.com/wxa/msg_sec_check?access_token=' + encodeURIComponent(accessToken),
		{
			method: 'POST',
			contentType: 'json',
			data: {
				version: 2,
				scene: 2,
				openid,
				content: String(content || '').slice(0, 2500)
			},
			dataType: 'json',
			timeout: 10000
		}
	);
	const body = httpRes && httpRes.data;
	if (!body || body.errcode !== 0 || !body.result) {
		const e = new Error((body && body.errmsg) || 'msgSecCheck无结果');
		e.body = body;
		throw e;
	}
	return { pass: body.result.suggest === 'pass', detail: body.result };
}

module.exports = { checkTextRisk, localTextRiskCheck };
