'use strict';

/**
 * 管理员鉴权：仅 uni-id-users.is_admin === 1 放行
 * is_admin 无客户端写入入口，只能在 uniCloud 控制台手动设置，无法伪造
 * @returns {null|object} null=通过；否则为可直接 return 的错误对象
 */
async function requireAdmin(userCol, uid) {
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
	const uRes = await userCol.doc(uid).get();
	const u = uRes.data && uRes.data[0];
	if (!u || u.is_admin !== 1) return { errCode: 'NO_PERMISSION', errMsg: '无管理员权限' };
	return null;
}

/**
 * 登录用户状态校验：status === 1（被禁用）的用户禁止一切写入操作
 * uni-id-users.status 为 uni-id 内置字段（0 正常 / 1 禁用），复用为封禁标记
 * @returns {null|object} null=正常；否则为可直接 return 的错误对象
 */
async function requireActiveUser(userCol, uid) {
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
	const uRes = await userCol.doc(uid).get();
	const u = uRes.data && uRes.data[0];
	if (u && u.status === 1) {
		return { errCode: 'USER_BANNED', errMsg: '账号已被禁用，无法执行此操作' };
	}
	return null;
}

module.exports = { requireAdmin, requireActiveUser };
