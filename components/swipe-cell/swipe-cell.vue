<script lang="ts">
// 同级滑动项共享：同一时刻只允许一个展开
let activeClose: (() => void) | null = null;
</script>

<template>
	<view
		class="swipe-cell"
		:style="{ marginBottom: gap + 'rpx' }"
		@touchstart="onTouchStart"
		@touchmove="onTouchMove"
		@touchend="onTouchEnd"
		@touchcancel="onTouchEnd"
	>
		<!-- 底层操作按钮：仅在拖动/展开时渲染，静止时不画红色按钮，避免右侧透出红边与首屏闪现 -->
		<view v-if="offset !== 0" class="swipe-actions" :style="{ width: actionsWidthPx + 'px' }">
			<view
				v-for="a in actions"
				:key="a.key"
				class="action"
				:class="a.type"
				@click.stop="onAction(a)"
			>
				{{ a.label }}
			</view>
		</view>
		<!-- 上层内容：左滑露出按钮；静止时不写 transform，避免合成层边缘透出底层红条 -->
		<view class="swipe-content" :class="{ dragging }" :style="contentStyle">
			<slot />
		</view>
		<!-- 滑开时的点击遮罩：盖住内容区（右侧按钮区留空），点击只收起；触摸事件冒泡到外层继续支持右滑收起 -->
		<view
			v-if="offset !== 0"
			class="swipe-mask"
			:style="{ right: actionsWidthPx + 'px' }"
			@click.stop="close"
		></view>
	</view>
</template>

<script setup lang="ts">
	import { ref, computed, onUnmounted } from 'vue';

	interface SwipeAction {
		key: string;
		label: string;
		type?: string;
	}

	const props = withDefaults(
		defineProps<{
			actions?: SwipeAction[];
			width?: number;
			gap?: number;
		}>(),
		{
			actions: () => [],
			width: 140,
			gap: 20
		}
	);

	const emit = defineEmits<{
		(e: 'action', key: string): void;
	}>();

	const actionsWidthPx = uni.upx2px(props.width);
	const offset = ref(0);
	const dragging = ref(false);
	// 静止（offset=0）时不写 transform：位移层会生成合成层，右边缘抗锯齿会透出底层按钮的红色
	const contentStyle = computed(() =>
		offset.value ? { transform: 'translateX(' + offset.value + 'px)' } : {}
	);

	let startX = 0;
	let startY = 0;
	let baseOffset = 0;
	let isHorizontal: boolean | null = null;

	function close() {
		offset.value = 0;
		if (activeClose === close) activeClose = null;
	}

	function onTouchStart(e: any) {
		// 同时只展开一个：先收起上一个
		if (activeClose && activeClose !== close) activeClose();
		activeClose = close;
		const t = e.touches[0];
		startX = t.clientX;
		startY = t.clientY;
		baseOffset = offset.value;
		isHorizontal = null;
		dragging.value = true;
	}

	function onTouchMove(e: any) {
		const t = e.touches[0];
		const dx = t.clientX - startX;
		const dy = t.clientY - startY;
		// 首次有效位移时判定方向：竖向滚动不拦截
		if (isHorizontal === null) {
			if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
			isHorizontal = Math.abs(dx) > Math.abs(dy);
		}
		if (!isHorizontal) return;
		offset.value = Math.min(0, Math.max(-actionsWidthPx, baseOffset + dx));
	}

	function onTouchEnd() {
		dragging.value = false;
		if (isHorizontal) {
			// 超过 1/3 宽度自动展开，否则弹回
			offset.value = offset.value < -actionsWidthPx / 3 ? -actionsWidthPx : 0;
		}
		isHorizontal = null;
	}

	// 滑开时点击内容只收起：由遮罩层接管（小程序不支持事件捕获阶段）
	function onAction(a: SwipeAction) {
		close();
		emit('action', a.key);
	}

	onUnmounted(() => {
		if (activeClose === close) activeClose = null;
	});
</script>

<style lang="scss" scoped>
	.swipe-cell {
		position: relative;
		border-radius: 20rpx;
		overflow: hidden;
	}

	.swipe-actions {
		position: absolute;
		right: 0;
		top: 0;
		bottom: 0;
		display: flex;

		.action {
			flex: 1;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 28rpx;
			color: #fff;

			&.edit {
				background: #4facfe;
			}

			&.delete {
				background: #e65a5a;
			}
		}
	}

	.swipe-content {
		position: relative;
		transition: transform 0.25s ease;

		// 拖动过程中关掉过渡，跟手
		&.dragging {
			transition: none;
		}
	}

	.swipe-mask {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		z-index: 2;
	}
</style>
