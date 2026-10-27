import { ref, onUnmounted } from 'vue';

/**
 * 骨架屏显隐控制。
 *
 * 数据到达后先给骨架加淡出态（.sk-out），过渡结束后再移除 DOM，
 * 使「骨架淡出」与「真实内容错位浮现」交错进行 —— 整页不跳动、不闪白。
 *
 * @param fadeMs 骨架淡出时长，需与全局样式 .sk-layer 的 transition 时长一致
 */
export function useSkeleton(fadeMs = 300) {
	const skVisible = ref(true);
	const skFading = ref(false);
	let timer: ReturnType<typeof setTimeout> | null = null;

	/** 数据就绪：触发骨架淡出，动画结束后移除 */
	function skDone() {
		if (skFading.value || !skVisible.value) return;
		skFading.value = true;
		timer = setTimeout(() => {
			skVisible.value = false;
			timer = null;
		}, fadeMs);
	}

	/** 重新加载（下拉刷新/切换 Tab）：立刻恢复骨架 */
	function skRestart() {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		skVisible.value = true;
		skFading.value = false;
	}

	onUnmounted(() => {
		if (timer) clearTimeout(timer);
	});

	return { skVisible, skFading, skDone, skRestart };
}
