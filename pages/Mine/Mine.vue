<template>
	<view class="mine-page">
		<view class="user-header">
			<view class="user-card" @click="handleCardClick">
				<image v-if="isLogin && avatarUrl" class="avatar" :src="avatarUrl" mode="aspectFill"></image>
				<view v-else class="avatar avatar-default">
					<uni-icons type="person-filled" size="44" color="#9bb8d3"></uni-icons>
				</view>
				<view class="user-meta">
					<view v-if="isLogin" class="nickname">{{ userInfo.nickname }}</view>
					<view v-else class="login-tip">
						<text>点击登录</text>
						<uni-icons type="right" size="16" color="#5a8db3"></uni-icons>
					</view>
				</view>
			</view>
		</view>

		<view v-if="isLogin" class="menu">
			<view v-if="!hideComments" class="menu-item" @click="goMyUploads">
				<view class="menu-left">
					<uni-icons type="images" size="22" color="#2c98e7"></uni-icons>
					<text class="menu-text">我的上传</text>
				</view>
				<uni-icons type="right" size="16" color="#b5c8d8"></uni-icons>
			</view>
			<view class="menu-item" @click="goFavorites">
				<view class="menu-left">
					<uni-icons type="star-filled" size="22" color="#f5a623"></uni-icons>
					<text class="menu-text">我的收藏</text>
				</view>
				<uni-icons type="right" size="16" color="#b5c8d8"></uni-icons>
			</view>
		</view>

		<view v-if="isLogin && isAdmin" class="menu">
			<view class="menu-item" @click="goAdmin">
				<view class="menu-left">
					<uni-icons type="auth-filled" size="22" color="#8e6bf1"></uni-icons>
					<text class="menu-text">后台管理</text>
				</view>
				<uni-icons type="right" size="16" color="#b5c8d8"></uni-icons>
			</view>
		</view>

		<view class="menu">
			<view class="menu-item" @click="goNotice">
				<view class="menu-left">
					<uni-icons type="notification" size="22" color="#e6a23c"></uni-icons>
					<text class="menu-text">公告</text>
				</view>
				<uni-icons type="right" size="16" color="#b5c8d8"></uni-icons>
			</view>
		</view>

		<view v-if="isLogin" class="logout-box">
			<button class="logout-btn" @click="handleLogout">退出登录</button>
		</view>

		<!-- 常驻发布入口（受内容开关控制） -->
		<view v-if="isLogin && !hideComments" class="fab" @click="goPublish">
			<uni-icons type="plusempty" size="34" color="#fff"></uni-icons>
		</view>
	</view>
</template>

<script setup lang="ts">
	import { ref, computed } from 'vue';
	import { onShow, onHide } from '@dcloudio/uni-app';
	import { resolveFileUrl } from '../../utils/cloud-file';
	import { useUserStore } from '../../store/user';
	import { useAppConfigStore } from '../../store/app-config';
	import { storeToRefs } from 'pinia';
	import type { UserInfo } from '../../utils/auth';

	// 登录态/用户信息：从全局 store 响应式读取，登录/登出自动同步
	const userStore = useUserStore();
	const { isLogin } = storeToRefs(userStore);
	// 全局开关：true 时隐藏评论/上传相关入口
	const appStore = useAppConfigStore();
	const { hideContent: hideComments } = storeToRefs(appStore);
	const userInfo = computed<UserInfo>(() => userStore.userInfo || { _id: '', nickname: '', avatar: '' });
	const avatarUrl = ref('');
	// 是否超级管理员（登录时由 user-login 返回，随 userInfo 存本地）
	const isAdmin = computed(() => userInfo.value.is_admin === 1);

	async function refreshUser(): Promise<void> {
		avatarUrl.value = '';
		if (isLogin.value && userInfo.value.avatar) {
			try {
				avatarUrl.value = await resolveFileUrl(userInfo.value.avatar);
			} catch (e) {
				// 换取失败保持默认头像，不阻断页面
				console.warn('头像地址获取失败', e);
			}
		}
	}

	onShow(() => {
		refreshUser();
		// 登录页登录成功 / 退出登录时跨页面同步状态
		uni.$on('loginSuccess', refreshUser);
		uni.$on('logout', refreshUser);
	});

	onHide(() => {
		uni.$off('loginSuccess', refreshUser);
		uni.$off('logout', refreshUser);
	});

	function handleCardClick() {
		if (isLogin.value) return;
		uni.navigateTo({ url: '/pages/Login/login' });
	}

	function goMyUploads() {
		uni.navigateTo({ url: '/pages/MyUploads/my-uploads' });
	}

	function goFavorites() {
		uni.navigateTo({ url: '/pages/Favorites/favorites' });
	}

	function goAdmin() {
		uni.navigateTo({ url: '/pages/Admin/admin' });
	}

	function goNotice() {
		uni.navigateTo({ url: '/pages/Notice/notice' });
	}

	function goPublish() {
		uni.navigateTo({ url: '/pages/Publish/publish' });
	}

	function handleLogout() {
		uni.showModal({
			title: '提示',
			content: '确定退出登录吗？',
			success: (res) => {
				if (res.confirm) {
					userStore.logout();
					refreshUser();
					uni.showToast({ title: '已退出', icon: 'none' });
				}
			}
		});
	}
</script>

<style lang="scss">
	.mine-page {
		min-height: 100vh;
		background: #f5f7fa;
	}

	.user-header {
		padding: 60rpx 30rpx 30rpx;
		background-image: linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%);

		.user-card {
			display: flex;
			align-items: center;
			padding: 36rpx 30rpx;
			background: #fff;
			border-radius: 24rpx;
			box-shadow: 0 12rpx 30rpx rgba(56, 151, 228, 0.15);

			.avatar {
				width: 120rpx;
				height: 120rpx;
				border-radius: 50%;
				border: 2rpx solid #e4f0fa;
				box-sizing: border-box;
				background: #f2f8fe;
			}

			.avatar-default {
				display: flex;
				align-items: center;
				justify-content: center;
			}

			.user-meta {
				margin-left: 28rpx;

				.nickname {
					font-size: 36rpx;
					font-weight: bold;
					color: #333;
				}

				.login-tip {
					display: flex;
					align-items: center;
					font-size: 32rpx;
					color: #1d6fb8;
				}
			}
		}
	}

	.menu {
		padding: 24rpx 30rpx 0;

		.menu-item {
			display: flex;
			align-items: center;
			justify-content: space-between;
			background: #fff;
			border-radius: 20rpx;
			padding: 32rpx 30rpx;

			& + .menu-item {
				margin-top: 16rpx;
			}

			.menu-left {
				display: flex;
				align-items: center;

				.menu-text {
					margin-left: 18rpx;
					font-size: 30rpx;
					color: #333;
				}
			}
		}
	}

	.logout-box {
		padding: 40rpx 30rpx;

		.logout-btn {
			height: 88rpx;
			line-height: 88rpx;
			border-radius: 44rpx;
			background: #fff;
			color: #e65a5a;
			font-size: 30rpx;

			&::after {
				border: none;
			}
		}
	}

	.fab {
		position: fixed;
		right: 40rpx;
		bottom: 140rpx;
		width: 100rpx;
		height: 100rpx;
		border-radius: 50%;
		background: linear-gradient(135deg, #4facfe 0%, #2c98e7 100%);
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 8rpx 24rpx rgba(44, 152, 231, 0.45);
		z-index: 999;
	}
</style>
