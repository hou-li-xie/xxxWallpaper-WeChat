import { defineStore } from 'pinia';
import { getUserInfo, isLoggedIn, setLogin, logout as clearLogin, type UserInfo } from '../utils/auth';

/**
 * 全局登录态（Pinia 响应式）
 *
 * storage 读取均为同步，init() 即刻就绪（App onLaunch 调用一次）；
 * 页面通过 storeToRefs 读取 isLogin/userInfo，登录/登出自动跨页面同步，
 * 无需各自维护本地镜像 ref。
 */
export const useUserStore = defineStore('user', {
	state: () => ({
		userInfo: null as UserInfo | null
	}),
	getters: {
		/** 是否已登录 */
		isLogin: (state): boolean => !!(state.userInfo && state.userInfo._id),
		/** 昵称（兜底「用户」） */
		nickname: (state): string => (state.userInfo && state.userInfo.nickname) || '用户',
		/** 头像（可能为空） */
		avatar: (state): string => (state.userInfo && state.userInfo.avatar) || ''
	},
	actions: {
		/** 启动时从本地缓存恢复登录态（同步） */
		init(): void {
			this.userInfo = isLoggedIn() ? getUserInfo() : null;
		},
		/** 登录成功：写 storage + 更新全局态（内部会广播 loginSuccess 事件） */
		login(data: { token: string; tokenExpired?: number; userInfo?: UserInfo }): void {
			setLogin(data);
			this.userInfo = (data.userInfo as UserInfo) || null;
		},
		/** 退出登录：清 storage + 清全局态（内部会广播 logout 事件） */
		logout(): void {
			clearLogin();
			this.userInfo = null;
		}
	}
});
