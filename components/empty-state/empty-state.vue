<template>
	<!-- 空态：图标 + 文案 + 可选按钮，各列表页共用 -->
	<view class="empty-state" :style="{ paddingTop: top + 'rpx' }">
		<uni-icons v-if="icon" :type="icon" size="46" :color="iconColor"></uni-icons>
		<text class="empty-text">{{ text }}</text>
		<button v-if="buttonText" class="empty-btn" @click="emit('action')">{{ buttonText }}</button>
	</view>
</template>

<script setup lang="ts">
	withDefaults(
		defineProps<{
			icon?: string;
			iconColor?: string;
			text: string;
			top?: number;
			buttonText?: string;
		}>(),
		{
			icon: '',
			iconColor: '#bcd0e2',
			top: 180,
			buttonText: ''
		}
	);

	const emit = defineEmits<{
		(e: 'action'): void;
	}>();
</script>

<style lang="scss" scoped>
	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.empty-text {
		margin-top: 20rpx;
		font-size: 28rpx;
		color: #9bb4c9;
	}

	.empty-btn {
		margin-top: 36rpx;
		height: 76rpx;
		line-height: 76rpx;
		padding: 0 56rpx;
		border-radius: 38rpx;
		background: linear-gradient(90deg, #4facfe 0%, #2c98e7 100%);
		color: #fff;
		font-size: 28rpx;

		&::after {
			border: none;
		}
	}
</style>
