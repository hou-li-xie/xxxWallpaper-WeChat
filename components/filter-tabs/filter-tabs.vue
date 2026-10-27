<template>
	<!-- 顶部筛选标签栏：吸顶、等分、选中下划线，各列表页共用 -->
	<view class="tabs">
		<view
			v-for="tab in tabs"
			:key="tab.value"
			class="tab"
			:class="{ active: modelValue === tab.value }"
			@click="emit('change', tab.value)"
		>
			{{ tab.label }}
		</view>
	</view>
</template>

<script setup lang="ts">
	interface TabItem {
		label: string;
		value: string | number;
	}

	defineProps<{
		tabs: TabItem[];
		modelValue: string | number;
	}>();

	const emit = defineEmits<{
		(e: 'change', value: any): void;
	}>();
</script>

<style lang="scss" scoped>
	.tabs {
		position: sticky;
		top: 0;
		z-index: 10;
		display: flex;
		background: #fff;
		padding: 0 10rpx;
		box-shadow: 0 2rpx 12rpx rgba(56, 151, 228, 0.06);

		.tab {
			flex: 1;
			text-align: center;
			padding: 26rpx 0;
			font-size: 28rpx;
			color: #6b7d8f;
			position: relative;

			&.active {
				color: #2c98e7;
				font-weight: bold;

				&::after {
					content: '';
					position: absolute;
					bottom: 8rpx;
					left: 50%;
					transform: translateX(-50%);
					width: 48rpx;
					height: 6rpx;
					border-radius: 3rpx;
					background: #2c98e7;
				}
			}
		}
	}
</style>
