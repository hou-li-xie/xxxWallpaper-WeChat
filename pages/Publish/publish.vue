<template>
	<view class="publish-page">
		<view class="notice-card">
			<view class="icon-wrap">
				<uni-icons type="info-filled" size="52" color="#2c98e7"></uni-icons>
			</view>
			<text class="title">当前客户端暂时不可发布</text>
			<text class="description">登录后可通过账号迁移码，前往 H5 平台发布美照。</text>
		</view>

		<view class="steps-card">
			<text class="section-title">发布步骤</text>
			<view class="step-item">
				<text class="step-number">1</text>
				<text class="step-text">在「我的 - 账号迁移码」中获取迁移码</text>
			</view>
			<view class="step-item">
				<text class="step-number">2</text>
				<text class="step-text">在浏览器中打开 H5 平台，选择「账号迁移码登录」</text>
			</view>
			<view class="step-item">
				<text class="step-number">3</text>
				<text class="step-text">登录成功后即可发布美照</text>
			</view>
			<button class="migrate-btn" @click="goMigrateCode">获取账号迁移码</button>
		</view>
	</view>
</template>

<script setup lang="ts">
	import { isLoggedIn } from '../../utils/auth';

	function goMigrateCode() {
		const target = '/pages/Mine/migrate-code';
		if (isLoggedIn()) {
			uni.navigateTo({ url: target });
			return;
		}
		uni.navigateTo({
			url: '/pages/Login/login?redirect=' + encodeURIComponent(target)
		});
	}
</script>

<style lang="scss">
	.publish-page {
		min-height: 100vh;
		padding: 30rpx;
		box-sizing: border-box;
		background: #f5f7fa;
	}

	.notice-card,
	.steps-card {
		padding: 36rpx 30rpx;
		border-radius: 24rpx;
		background: #fff;
		box-shadow: 0 8rpx 24rpx rgba(56, 151, 228, 0.06);
	}

	.steps-card {
		margin-top: 24rpx;
	}

	.notice-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding-top: 48rpx;
		padding-bottom: 48rpx;

		.icon-wrap {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 104rpx;
			height: 104rpx;
			border-radius: 50%;
			background: #eaf5fd;
		}

		.title {
			margin-top: 28rpx;
			font-size: 34rpx;
			font-weight: bold;
			color: #333;
			text-align: center;
		}

		.description {
			margin-top: 18rpx;
			font-size: 27rpx;
			line-height: 1.7;
			color: #6b7a8a;
			text-align: center;
		}
	}

	.section-title {
		display: block;
		margin-bottom: 26rpx;
		font-size: 30rpx;
		font-weight: bold;
		color: #333;
	}

	.step-item {
		display: flex;
		align-items: center;

		& + .step-item {
			margin-top: 22rpx;
		}

		.step-number {
			display: flex;
			align-items: center;
			justify-content: center;
			flex-shrink: 0;
			width: 40rpx;
			height: 40rpx;
			border-radius: 50%;
			background: #eaf5fd;
			font-size: 24rpx;
			color: #2c98e7;
		}

		.step-text {
			margin-left: 18rpx;
			font-size: 27rpx;
			line-height: 1.5;
			color: #60778a;
		}
	}

	.migrate-btn {
		width: 100%;
		height: 88rpx;
		line-height: 88rpx;
		margin-top: 32rpx;
		border: 2rpx solid #c6def1;
		border-radius: 44rpx;
		background: #fff;
		color: #2c88cf;
		font-size: 30rpx;

		&::after {
			border: none;
		}
	}
</style>
