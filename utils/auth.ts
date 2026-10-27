/**
 * 登录态管理
 * token 使用 uni-id 约定的 storage key，clientDB 会自动携带到云函数/数据库请求
 */

export interface UserInfo {
	_id: string;
	nickname?: string;
	avatar?: string;
	[key: string]: any;
}

const TOKEN_KEY = 'uni_id_token';
const TOKEN_EXPIRED_KEY = 'uni_id_token_expired';
const USER_INFO_KEY = 'user_info';

/**
 * 获取本地 token
 */
export function getToken(): string {
	return uni.getStorageSync(TOKEN_KEY) || '';
}

/**
 * 获取本地用户信息 { _id, nickname, avatar }
 */
export function getUserInfo(): UserInfo | null {
	return (uni.getStorageSync(USER_INFO_KEY) as UserInfo) || null;
}

/**
 * 判断当前是否已登录（token 存在且未过期）
 * 本地时间可能不准，过期判断只作为前置拦截，真正校验以云端 checkToken 为准
 */
export function isLoggedIn(): boolean {
	const token = getToken();
	if (!token) return false;
	const expired = Number(uni.getStorageSync(TOKEN_EXPIRED_KEY) || 0);
	if (expired && expired <= Date.now()) return false;
	return true;
}

/**
 * 保存登录结果
 */
export function setLogin(data: { token: string; tokenExpired?: number; userInfo?: UserInfo }): void {
	uni.setStorageSync(TOKEN_KEY, data.token);
	uni.setStorageSync(TOKEN_EXPIRED_KEY, data.tokenExpired || 0);
	uni.setStorageSync(USER_INFO_KEY, data.userInfo || {});
	uni.$emit('loginSuccess', data.userInfo);
}

/**
 * 退出登录，清除本地登录态
 */
export function logout(): void {
	uni.removeStorageSync(TOKEN_KEY);
	uni.removeStorageSync(TOKEN_EXPIRED_KEY);
	uni.removeStorageSync(USER_INFO_KEY);
	uni.$emit('logout');
}

/**
 * 登录拦截：未登录时跳转登录页
 * @param redirect 登录成功后需要回跳的页面路径（含参数）
 * @returns true=已登录可继续，false=未登录已跳转
 */
export function requireLogin(redirect?: string): boolean {
	if (isLoggedIn()) return true;
	let url = '/pages/Login/login';
	if (redirect) {
		url += '?redirect=' + encodeURIComponent(redirect);
	}
	uni.navigateTo({ url });
	return false;
}
