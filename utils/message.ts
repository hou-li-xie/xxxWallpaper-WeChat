/**
 * 云函数调用封装
 *
 * 未读角标逻辑已迁移至 store/message.ts（Pinia 响应式管理 unread 并同步 tabBar 角标）
 */

/**
 * 调用云函数的统一小封装，直接返回 result
 */
export function callMessage(action: string, data: Record<string, any> = {}) {
	return uniCloud
		.callFunction({ name: 'wallpaper-action', data: { action, ...data } })
		.then((res: any) => res.result);
}
