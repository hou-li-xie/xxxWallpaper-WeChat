<template>
	<view class="publish-page">
		<uni-icons type="info-filled" size="72" color="#a7bfd3"></uni-icons>
		<text class="tip">受不可控因素影响，暂时不允许发布，详情咨询开发者</text>
		<button class="goto-btn" @click="goNotice">查看公告</button>
	</view>
</template>

<script setup lang="ts">
	function goNotice() {
		uni.navigateTo({ url: '/pages/Notice/notice' });
	}
</script>

<style lang="scss">
	.publish-page {
		min-height: 100vh;
		background: #f5f7fa;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 60rpx;
		box-sizing: border-box;

		.tip {
			margin-top: 32rpx;
			font-size: 28rpx;
			color: #6b7a8a;
			text-align: center;
			line-height: 1.7;
		}

		.goto-btn {
			margin-top: 48rpx;
			padding: 0 56rpx;
			height: 80rpx;
			line-height: 80rpx;
			border-radius: 40rpx;
			background: linear-gradient(90deg, #4facfe 0%, #2c98e7 100%);
			color: #fff;
			font-size: 28rpx;
			font-weight: bold;

			&::after {
				border: none;
			}
		}
	}
</style>
