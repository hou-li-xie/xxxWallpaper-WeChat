<template>
	<!-- 双列瀑布流：只负责分流与列布局，卡片内容由默认插槽渲染；页面可为根节点追加类名控制外层间距 -->
	<view class="waterfall">
		<view
			class="waterfall-col"
			v-for="(col, ci) in columns"
			:key="ci"
			:style="{ marginLeft: ci ? gap + 'rpx' : '0' }"
		>
			<view
				class="waterfall-item reveal-blk"
				v-for="(item, index) in col"
				:key="item._id || index"
				:style="{ marginBottom: gap + 'rpx', animationDelay: Math.min(index, 5) * 60 + 'ms' }"
			>
				<slot :item="item" :index="index" :column="ci" />
			</view>
		</view>
	</view>
</template>

<script setup lang="ts">
	import { ref, computed, watch } from 'vue';

	const props = withDefaults(
		defineProps<{
			source: any[];
			metaHeight?: number;
			gap?: number;
			padding?: number;
		}>(),
		{
			metaHeight: 0,
			gap: 20,
			padding: 20
		}
	);

	// 两列数据（每列为源数组中的一部分，保持稳定引用）
	const columns = ref<any[][]>([[], []]);
	// 各列累计高度（px，仅用于分流决策，不参与渲染）
	const colHeights = [0, 0];
	// 已分流的源数据，用于识别「追加」还是「清空/替换」
	const processed = ref<any[]>([]);

	// 列宽（rpx）：屏宽 750 - 页面左右 padding - 列间距，均分两列
	// padding 仅参与宽度计算，实际外边距由页面容器提供（组件根节点可追加类名）
	const colWidth = computed(() => (750 - props.padding * 2 - props.gap) / 2);

	// 展示高度（rpx）：按图片真实宽高比换算，极端比例钳制在列宽的 0.75~2.2 倍
	function calcH(item: any): number {
		const w = Number(item.width) || 375;
		const h = Number(item.height) || 400;
		const vh = colWidth.value * (h / w);
		return Math.round(Math.max(colWidth.value * 0.75, Math.min(colWidth.value * 2.2, vh)));
	}

	function reset() {
		columns.value = [[], []];
		colHeights[0] = 0;
		colHeights[1] = 0;
		processed.value = [];
	}

	function append(items: any[]) {
		const metaPx = uni.upx2px(props.metaHeight);
		const gapPx = uni.upx2px(props.gap);
		items.forEach((item) => {
			const heightRpx = calcH(item);
			item._h = heightRpx;
			const ci = colHeights[0] <= colHeights[1] ? 0 : 1;
			columns.value[ci].push(item);
			colHeights[ci] += uni.upx2px(heightRpx) + metaPx + gapPx;
		});
		processed.value = processed.value.concat(items);
	}

	// 源数组变化：前缀一致视为追加（增量分流）；变短/整体替换则重排
	watch(
		[() => props.source, () => props.source.length],
		() => {
			const source = props.source;
			const prev = processed.value;
			let same = 0;
			while (same < prev.length && same < source.length && prev[same] === source[same]) same++;
			// 完全一致：无需处理
			if (same === prev.length && same === source.length) return;
			// 纯追加：只处理新增部分
			if (same === prev.length) {
				append(source.slice(same));
				return;
			}
			// 清空、变短或整体替换：全量重排
			reset();
			append(source);
		},
		{ immediate: true }
	);
</script>

<style lang="scss" scoped>
	.waterfall {
		display: flex;
		align-items: flex-start;
		/* 页面把 .wf/.masonry 挂在组件宿主上（宿主被设为 flex 容器），
		   本节点作为 flex 子项默认按内容收缩，必须显式占满一行，否则右侧留白 */
		width: 100%;
		box-sizing: border-box;
	}

	.waterfall-col {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.waterfall-item {
		width: 100%;
	}
</style>
