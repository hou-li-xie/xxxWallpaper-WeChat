'use strict';
const { weixinLogin } = require('./modules/weixin');
const { guestLogin } = require('./modules/guest');
const { univerifyLogin } = require('./modules/univerify');
const { savePushCid } = require('./modules/push');
const { getMigrateCode, resetMigrateCode, migrateByCode } = require('./modules/migrate');

/**
 * 登录云函数（多端统一入口）
 *
 * event.type 分发：
 *   weixin（默认） 微信小程序登录：code 换 openid -> 查/建用户 -> 签发 token
 *   guest         App 游客式登录：昵称 + 头像建档，凭本地持久 guest_id 识别老用户
 *                 （头像统一由客户端上传云存储，传 cloud:// fileID；内置头像也经客户端转换路径后上传）
 *   univerify     App 本机号码一键登录（已弃用，保留代码备用）
 *   savePushCid   App 端保存 uniPush 客户端标识 push_cid（需携带登录态 token）
 *   getMigrateCode / resetMigrateCode / migrateByCode  账号迁移码（换机/重装恢复）
 *
 * 微信配置在 uni-config-center/user-login/config.json（appid/appsecret）
 */
async function handleLogin(event, context) {
	const type = String(event.type || 'weixin');
	if (type === 'guest') return guestLogin(event, context);
	if (type === 'univerify') return univerifyLogin(event, context);
	if (type === 'savePushCid') return savePushCid(event, context);
	if (type === 'getMigrateCode') return getMigrateCode(event, context);
	if (type === 'resetMigrateCode') return resetMigrateCode(event, context);
	if (type === 'migrateByCode') return migrateByCode(event, context);
	return weixinLogin(event, context);
}

// 兜底捕获未处理异常，把真实错误信息与堆栈回传给客户端，便于定位
exports.main = async (event, context) => {
	try {
		return await handleLogin(event, context);
	} catch (e) {
		console.error('[user-login] crash:', e && (e.stack || e.errMsg || e.message || e));
		return {
			errCode: 'INTERNAL_ERROR',
			errMsg: '[user-login] ' + (e && (e.message || e.errMsg || e.errCode || JSON.stringify(e))),
			stack: (e && e.stack) || ''
		};
	}
};
