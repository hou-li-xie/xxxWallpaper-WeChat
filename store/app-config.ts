import { defineStore } from 'pinia';

let pending: Promise<void> | null = null;

/**
 * 全局内容开关（app_config 表，全表仅一条记录）
 *
 * hide_content=true 时隐藏评论/上传等社交相关内容（审核期间用），false 正常展示。
 * 读取不依赖 _id（web 控制台插入时 _id 是自动生成的），直接取表内第一条；
 * init() 幂等：App 进程生命周期内只查一次，并发/重复调用复用同一次请求；
 * 读取失败按「隐藏」兜底（与审核期状态一致，宁可不展示）。
 * 页面通过 storeToRefs 读取 hideContent，响应式更新，无需各自请求。
 */
export const useAppConfigStore = defineStore('appConfig', {
	state: () => ({
		// true=隐藏；默认 true（隐藏兜底），读取成功后覆盖
		hideContent: true,
		loaded: false
	}),
	actions: {
		/** 拉取开关（幂等） */
		init(): Promise<void> {
			if (this.loaded) return Promise.resolve();
			if (pending) return pending;
			pending = uniCloud
				.database()
				.collection('app_config')
				.limit(1)
				.get()
				.then((res: any) => {
					const doc = res.result && res.result.data && res.result.data[0];
					this.hideContent = !!(doc && doc.hide_content);
				})
				.catch(() => {
					// 读取失败保持默认「隐藏」，与审核期安全状态一致
				})
				.finally(() => {
					this.loaded = true;
					pending = null;
				});
			return pending;
		}
	}
});
