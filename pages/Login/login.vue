<template>
	<view class="login-page">
		<view class="login-header">
			<image class="logo" src="/static/logo.jpeg" mode="aspectFill"></image>
			<view class="app-name">十月初美人鉴赏</view>
			<view v-if="!hideComments" class="app-tip">完善头像昵称后即可上传美图、点赞评论</view>
			<view v-else class="app-tip">完善头像昵称后即可上传美图、点赞收藏</view>
		</view>

		<view class="login-card">
			<!-- #ifdef MP-WEIXIN -->
			<!-- 微信「头像昵称填写能力」：点击按钮可直接使用微信头像 -->
			<button id="chooseAvatarBtn" class="avatar-btn" open-type="chooseAvatar" @chooseavatar="onChooseAvatar">
				<image v-if="avatarUrl" class="avatar" :src="avatarUrl" mode="aspectFill"></image>
				<view v-else class="avatar avatar-placeholder">
					<uni-icons type="camera-filled" size="34" color="#9bb8d3"></uni-icons>
					<text class="avatar-tip">选择微信头像</text>
				</view>
			</button>
			<!-- #endif -->

			<!-- #ifndef MP-WEIXIN -->
			<!-- 其他平台退化为本地选图 -->
			<view class="avatar-btn" @click="chooseAvatarFallback">
				<image v-if="avatarUrl" class="avatar" :src="avatarUrl" mode="aspectFill"></image>
				<view v-else class="avatar avatar-placeholder">
					<uni-icons type="camera-filled" size="34" color="#9bb8d3"></uni-icons>
					<text class="avatar-tip">点击上传头像</text>
				</view>
			</view>
			<!-- #endif -->

			<view class="form-item">
				<!-- type="nickname"：聚焦时键盘上方可一键使用微信昵称 -->
				<input
					class="nickname-input"
					type="nickname"
					v-model="nickname"
					placeholder="请输入昵称"
					placeholder-class="input-placeholder"
					maxlength="20"
				/>
			</view>

			<button class="submit-btn" :class="{ disabled: !canSubmit || loading }" :disabled="!canSubmit || loading" @click="handleLogin">
				{{ loading ? '登录中...' : '一键登录' }}
			</button>
		</view>
	</view>
</template>

<script setup lang="ts">
	import { ref, computed } from 'vue';
	import { onLoad } from '@dcloudio/uni-app';
	import { useUserStore } from '../../store/user';
	import { storeToRefs } from 'pinia';
	import { useAppConfigStore } from '../../store/app-config';

	// 全局开关：true 时隐藏评论相关文案
	const appStore = useAppConfigStore();
	const { hideContent: hideComments } = storeToRefs(appStore);

	// 登录态统一走全局 user store（store 内部写 storage 并广播 loginSuccess）
	const userStore = useUserStore();

	const avatarUrl = ref(''); // chooseAvatar 返回的本地临时路径
	const nickname = ref('');
	const loading = ref(false);
	const redirectUrl = ref('');

	const canSubmit = computed(() => !!avatarUrl.value && !!nickname.value.trim());

	onLoad((options: any) => {
		if (options && options.redirect) {
			redirectUrl.value = decodeURIComponent(options.redirect);
		}
	});

	// 微信头像选择回调
	function onChooseAvatar(e: any) {
		const tempUrl = e && e.detail && e.detail.avatarUrl;
		if (tempUrl) avatarUrl.value = tempUrl;
	}

	// 非微信平台：本地选图兜底
	async function chooseAvatarFallback() {
		try {
			const res = await uni.chooseImage({ count: 1, sizeType: ['compressed'] });
			if (res.tempFilePaths && res.tempFilePaths.length) {
				avatarUrl.value = res.tempFilePaths[0];
			}
		} catch (e) {
			// 用户取消，不提示
		}
	}

	async function handleLogin() {
		if (loading.value) return;
		const name = nickname.value.trim();
		if (!avatarUrl.value) {
			return uni.showToast({ title: '请先选择头像', icon: 'none' });
		}
		if (!name) {
			return uni.showToast({ title: '请填写昵称', icon: 'none' });
		}

		loading.value = true;
		uni.showLoading({ title: '登录中', mask: true });
		try {
			// 1. 获取新鲜的微信登录 code（code 有效期短，提交时再取）
			const loginRes = await uni.login({ provider: 'weixin' });
			if (!loginRes || !loginRes.code) {
				throw new Error('微信登录凭证获取失败');
			}

			// 2. 头像先上传云存储，拿到 fileID
			const match = avatarUrl.value.match(/\.(jpg|jpeg|png|gif|webp)$/i);
			const ext = match ? match[1].toLowerCase() : 'jpg';
			const cloudPath = `avatar/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
			const upRes = await uniCloud.uploadFile({
				filePath: avatarUrl.value,
				cloudPath
			});
			if (!upRes || !upRes.fileID) {
				throw new Error('头像上传失败');
			}

			// 3. 携带 code + 昵称 + 头像 fileID 调用登录云函数
			const fnRes = await uniCloud.callFunction({
				name: 'user-login',
				data: {
					code: loginRes.code,
					nickname: name,
					avatar: upRes.fileID
				}
			});
			const result = fnRes && fnRes.result;
			if (!result || result.errCode !== 0) {
				throw new Error((result && result.errMsg) || '登录失败');
			}

			// 4. 持久化登录态并同步全局 store（store 内部会写 storage 并广播 loginSuccess）
			userStore.login({
				token: result.token,
				tokenExpired: result.tokenExpired,
				userInfo: result.userInfo
			});

			uni.showToast({ title: '登录成功', icon: 'success' });
			setTimeout(navigateAfterLogin, 400);
		} catch (e) {
			uni.showToast({ title: (e && e.message) || '登录失败', icon: 'none' });
		} finally {
			loading.value = false;
			uni.hideLoading();
		}
	}

	function navigateAfterLogin() {
		if (redirectUrl.value) {
			uni.redirectTo({
				url: redirectUrl.value,
				fail: () => uni.switchTab({ url: redirectUrl.value })
			});
			return;
		}
		const pages = getCurrentPages();
		if (pages.length > 1) {
			uni.navigateBack();
		} else {
			uni.switchTab({ url: '/pages/Mine/Mine' });
		}
	}
</script>

<style lang="scss">
	.login-page {
		min-height: 100vh;
		background: linear-gradient(180deg, #a1c4fd 0%, #c2e9fb 320rpx, #f5f7fa 100%);
	}

	.login-header {
		padding-top: 140rpx;
		display: flex;
		flex-direction: column;
		align-items: center;

		.logo {
			width: 150rpx;
			height: 150rpx;
			border-radius: 36rpx;
			box-shadow: 0 12rpx 30rpx rgba(56, 151, 228, 0.25);
		}

		.app-name {
			margin-top: 24rpx;
			font-size: 40rpx;
			font-weight: bold;
			color: #1d6fb8;
		}

		.app-tip {
			margin-top: 12rpx;
			font-size: 26rpx;
			color: #5a8db3;
		}
	}

	.login-card {
		margin: 70rpx 50rpx 0;
		padding: 60rpx 40rpx 70rpx;
		background: #fff;
		border-radius: 28rpx;
		box-shadow: 0 16rpx 40rpx rgba(56, 151, 228, 0.12);
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.avatar-btn {
		width: 180rpx;
		height: 180rpx;
		padding: 0;
		margin: 0;
		background: transparent;
		line-height: normal;
		border-radius: 50%;

		&::after {
			border: none;
		}

		.avatar {
			width: 180rpx;
			height: 180rpx;
			border-radius: 50%;
			border: 4rpx solid #d7e8f7;
			box-sizing: border-box;
		}

		.avatar-placeholder {
			background: #f2f8fe;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;

			.avatar-tip {
				margin-top: 10rpx;
				font-size: 22rpx;
				color: #7fa9c9;
			}
		}
	}

	.form-item {
		width: 100%;
		margin-top: 50rpx;
		height: 96rpx;
		background: #f5f9fd;
		border-radius: 48rpx;
		display: flex;
		align-items: center;
		padding: 0 36rpx;
		box-sizing: border-box;

		.nickname-input {
			flex: 1;
			font-size: 30rpx;
			color: #333;
		}

		.input-placeholder {
			color: #a7bfd3;
		}
	}

	.submit-btn {
		width: 100%;
		margin-top: 60rpx;
		height: 92rpx;
		line-height: 92rpx;
		border-radius: 46rpx;
		background: linear-gradient(90deg, #4facfe 0%, #2c98e7 100%);
		color: #fff;
		font-size: 32rpx;
		font-weight: bold;

		&::after {
			border: none;
		}

		&.disabled {
			opacity: 0.55;
		}
	}
</style>
