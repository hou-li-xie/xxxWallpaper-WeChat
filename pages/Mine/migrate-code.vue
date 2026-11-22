<template>
	<view class="migrate-page">
		<view class="intro-card">
			<view class="intro-icon">
				<uni-icons type="auth-filled" size="34" color="#2c98e7"></uni-icons>
			</view>
			<view class="intro-content">
				<text class="intro-title">账号迁移码</text>
				<text class="intro-subtitle">使用迁移码在 H5 端恢复并登录当前账号</text>
			</view>
		</view>

		<view class="code-card">
			<text class="card-title">我的迁移码</text>
			<view class="code-box" :class="{ 'code-placeholder': !migrateCode }">
				<text v-if="migrateCode">{{ migrateCode }}</text>
				<text v-else>{{ loading ? '正在生成...' : '暂未生成' }}</text>
			</view>
			<text class="code-tip">由 8 位大写字母和数字组成</text>

			<button
				class="copy-btn"
				:disabled="!migrateCode || loading || resetting"
				@click="copyCode"
			>复制迁移码</button>
			<button
				class="reset-btn"
				:disabled="loading || resetting"
				@click="confirmReset"
			>{{ resetting ? '正在生成...' : (migrateCode ? '重新生成' : '生成迁移码') }}</button>
		</view>

		<view class="guide-card">
			<text class="guide-title">如何在 H5 端登录</text>
			<view class="guide-item">
				<text class="step">1</text>
				<text class="guide-text">打开项目 H5 端，进入登录页面</text>
			</view>
			<view class="guide-item">
				<text class="step">2</text>
				<text class="guide-text">选择「账号迁移码登录」</text>
			</view>
			<view class="guide-item">
				<text class="step">3</text>
				<text class="guide-text">输入此迁移码，即可登录当前账号</text>
			</view>
		</view>

		<view class="warning">
			<text>请妥善保管迁移码，不要分享给他人。重新生成后，旧迁移码将立即失效。</text>
		</view>
	</view>
</template>

<script setup lang="ts">
	import { ref } from 'vue';
	import { onLoad } from '@dcloudio/uni-app';
	import { isLoggedIn } from '../../utils/auth';

	const migrateCode = ref('');
	const loading = ref(false);
	const resetting = ref(false);

	onLoad(() => {
		if (!isLoggedIn()) {
			redirectToLogin();
			return;
		}
		fetchMigrateCode();
	});

	function redirectToLogin() {
		const redirect = encodeURIComponent('/pages/Mine/migrate-code');
		uni.redirectTo({ url: '/pages/Login/login?redirect=' + redirect });
	}

	async function fetchMigrateCode() {
		if (loading.value) return;
		loading.value = true;
		try {
			const res = await uniCloud.callFunction({
				name: 'user-login',
				data: { type: 'getMigrateCode' }
			});
			const result = res.result || {};
			if (result.errCode === 'LOGIN_REQUIRED') {
				redirectToLogin();
				return;
			}
			if (result.errCode !== 0) {
				throw new Error(result.errMsg || '迁移码获取失败');
			}
			migrateCode.value = result.migrateCode || '';
		} catch (e) {
			console.error('[migrate-code] 获取迁移码失败', e);
			uni.showToast({
				title: e instanceof Error ? e.message : '迁移码获取失败，请重试',
				icon: 'none'
			});
		} finally {
			loading.value = false;
		}
	}

	function confirmReset() {
		if (loading.value || resetting.value) return;
		if (!migrateCode.value) {
			resetMigrateCode();
			return;
		}
		uni.showModal({
			title: '重新生成迁移码',
			content: '重新生成后，旧迁移码将立即失效，确定继续吗？',
			confirmText: '重新生成',
			success: (res) => {
				if (res.confirm) resetMigrateCode();
			}
		});
	}

	async function resetMigrateCode() {
		if (resetting.value) return;
		resetting.value = true;
		try {
			const res = await uniCloud.callFunction({
				name: 'user-login',
				data: { type: 'resetMigrateCode' }
			});
			const result = res.result || {};
			if (result.errCode === 'LOGIN_REQUIRED') {
				redirectToLogin();
				return;
			}
			if (result.errCode !== 0) {
				throw new Error(result.errMsg || '迁移码生成失败');
			}
			migrateCode.value = result.migrateCode || '';
			uni.showToast({ title: '新迁移码已生成', icon: 'success' });
		} catch (e) {
			console.error('[migrate-code] 重新生成失败', e);
			uni.showToast({
				title: e instanceof Error ? e.message : '迁移码生成失败，请重试',
				icon: 'none'
			});
		} finally {
			resetting.value = false;
		}
	}

	function copyCode() {
		if (!migrateCode.value) return;
		uni.setClipboardData({
			data: migrateCode.value,
			success: () => {
				uni.showToast({ title: '迁移码已复制', icon: 'success' });
			}
		});
	}
</script>

<style lang="scss">
	.migrate-page {
		min-height: 100vh;
		padding: 30rpx;
		box-sizing: border-box;
		background: #f5f7fa;
	}

	.intro-card {
		display: flex;
		align-items: center;
		padding: 36rpx 30rpx;
		border-radius: 24rpx;
		background: linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%);

		.intro-icon {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 84rpx;
			height: 84rpx;
			border-radius: 50%;
			background: rgba(255, 255, 255, 0.85);
		}

		.intro-content {
			display: flex;
			flex-direction: column;
			margin-left: 24rpx;
		}

		.intro-title {
			font-size: 36rpx;
			font-weight: bold;
			color: #1d6fb8;
		}

		.intro-subtitle {
			margin-top: 10rpx;
			font-size: 25rpx;
			line-height: 1.5;
			color: #466f91;
		}
	}

	.code-card,
	.guide-card {
		margin-top: 24rpx;
		padding: 36rpx 30rpx;
		border-radius: 24rpx;
		background: #fff;
		box-shadow: 0 8rpx 24rpx rgba(56, 151, 228, 0.06);
	}

	.code-card {
		display: flex;
		flex-direction: column;
		align-items: center;

		.card-title {
			align-self: flex-start;
			font-size: 30rpx;
			font-weight: bold;
			color: #333;
		}

		.code-box {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 100%;
			height: 130rpx;
			margin-top: 30rpx;
			box-sizing: border-box;
			border: 2rpx dashed #9ec9ef;
			border-radius: 20rpx;
			background: #f2f8fe;
			font-family: monospace;
			font-size: 46rpx;
			font-weight: bold;
			letter-spacing: 8rpx;
			color: #1d6fb8;
		}

		.code-placeholder {
			font-family: inherit;
			font-size: 28rpx;
			font-weight: normal;
			letter-spacing: 0;
			color: #8aa5bb;
		}

		.code-tip {
			margin-top: 18rpx;
			font-size: 24rpx;
			color: #8aa5bb;
		}

		.copy-btn,
		.reset-btn {
			width: 100%;
			height: 88rpx;
			line-height: 88rpx;
			border-radius: 44rpx;
			font-size: 30rpx;

			&::after {
				border: none;
			}

			&[disabled] {
				opacity: 0.55;
			}
		}

		.copy-btn {
			margin-top: 36rpx;
			background: linear-gradient(90deg, #4facfe 0%, #2c98e7 100%);
			color: #fff;
		}

		.reset-btn {
			margin-top: 20rpx;
			border: 2rpx solid #c6def1;
			background: #fff;
			color: #2c88cf;
		}
	}

	.guide-card {
		.guide-title {
			display: block;
			margin-bottom: 26rpx;
			font-size: 30rpx;
			font-weight: bold;
			color: #333;
		}

		.guide-item {
			display: flex;
			align-items: center;

			& + .guide-item {
				margin-top: 22rpx;
			}
		}

		.step {
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

		.guide-text {
			margin-left: 18rpx;
			font-size: 27rpx;
			line-height: 1.5;
			color: #60778a;
		}
	}

	.warning {
		margin-top: 24rpx;
		padding: 24rpx 28rpx;
		border-radius: 18rpx;
		background: #fff5f3;
		font-size: 25rpx;
		line-height: 1.6;
		color: #b26a5d;
	}
</style>
