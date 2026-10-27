import { defineStore } from 'pinia';
import { isLoggedIn } from '../utils/auth';

const MESSAGE_TAB_INDEX = 1;

/**
 * 消息未读角标（Pinia 响应式）
 *
 * tabBar 顺序：首页(0) 消息(1) 我的(2)；
 * unread 为响应式未读数（页面可直接展示），
 * refreshBadge() 同步 tabBar 角标；登录/登出事件在 init() 中统一挂接。
 */
export const useMessageStore = defineStore('message', {
	state: () => ({
		unread: 0
	}),
	actions: {
		/** 拉取未读数并刷新消息 tab 角标；未登录/为0时移除角标 */
		refreshBadge(): void {
			if (!isLoggedIn()) {
				this.unread = 0;
				uni.removeTabBarBadge({ index: MESSAGE_TAB_INDEX, fail: () => {} });
				return;
			}
			uniCloud
				.callFunction({
					name: 'wallpaper-action',
					data: { action: 'unreadCount' }
				})
				.then((res: any) => {
					this.unread = (res.result && res.result.count) || 0;
					if (this.unread > 0) {
						uni.setTabBarBadge({
							index: MESSAGE_TAB_INDEX,
							text: this.unread > 99 ? '99+' : String(this.unread),
							fail: () => {}
						});
					} else {
						uni.removeTabBarBadge({ index: MESSAGE_TAB_INDEX, fail: () => {} });
					}
				})
				.catch(() => {});
		},
		/** 登录/登出时自动刷新角标（App onLaunch 调用一次） */
		init(): void {
			uni.$on('loginSuccess', () => this.refreshBadge());
			uni.$on('logout', () => this.refreshBadge());
		}
	}
});
