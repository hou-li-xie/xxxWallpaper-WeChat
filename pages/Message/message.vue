<template>
	<view class="page">
		<!-- 订阅服务通知入口（模板配置好且为微信小程序才展示） -->
		<!-- #ifdef MP-WEIXIN -->
		<view v-if="!hideComments && templateId" class="sub-card">
			<view class="sub-left">
				<uni-icons type="notification" size="20" color="#2c98e7"></uni-icons>
				<view class="sub-text">
					<text class="sub-title">微信回复提醒</text>
					<text class="sub-desc">{{ subDescText }}</text>
				</view>
			</view>
			<view class="sub-btn" :class="{ disabled: subscribing }" @click="onSubCardClick">
				{{ subscribing ? '处理中' : subBtnText }}
			</view>
		</view>
		<!-- #endif -->

		<!-- 未登录 -->
		<view v-if="!isLogin" class="login-tip">
			<template v-if="!hideComments">
				<uni-icons type="chatbubble" size="46" color="#a7bfd3"></uni-icons>
				<text class="login-tip-text">登录后查看回复消息</text>
			</template>
			<template v-else>
				<uni-icons type="bell" size="46" color="#a7bfd3"></uni-icons>
				<text class="login-tip-text">登录后查看消息通知</text>
			</template>
			<view class="login-btn" @click="goLogin">去登录</view>
		</view>

		<template v-else>
			<view class="feed" :class="{ 'feed-loading': skVisible }">
				<view v-if="list.length" class="list-head">
					<text class="list-head-title">消息通知</text>
					<text class="read-all" @click="onMarkAllRead">全部已读</text>
				</view>

				<view class="msg-list">
					<!-- 左滑删除：交互与删除按钮由 swipe-cell 组件统一提供 -->
					<swipe-cell
						v-for="(n, index) in list"
						:key="n._id"
						:actions="msgActions"
						:width="140"
						:gap="16"
						@action="(key) => onSwipeAction(key, n)"
					>
							<view
								class="msg-item reveal-blk"
								:class="{ unread: !n.is_read }"
								:style="{ animationDelay: d(index, 0) }"
								@click="openNoti(n)"
							>
								<view class="avatar-wrap reveal-blk" :style="{ animationDelay: d(index, 1) }">
									<image v-if="n._avatarUrl" class="avatar" :src="n._avatarUrl" mode="aspectFill"></image>
									<view v-else class="avatar avatar-default">
										<uni-icons type="person-filled" size="18" color="#c2ccd8"></uni-icons>
									</view>
									<view v-if="!n.is_read" class="unread-dot"></view>
								</view>
								<view class="msg-body">
									<text class="msg-line reveal-blk" :style="{ animationDelay: d(index, 2) }">
										<text class="msg-name">{{ n.from && n.from.name ? n.from.name : '用户' }}</text>
										<text class="msg-action">{{ actionText(n.type) }}</text>
									</text>
									<text v-if="n.content" class="msg-content reveal-blk" :style="{ animationDelay: d(index, 3) }">{{ n.content }}</text>
									<text class="msg-time reveal-blk" :style="{ animationDelay: d(index, 4) }">{{ formatTime(n.create_time) }}</text>
								</view>
								<image
									v-if="n._wallpaperUrl"
									class="msg-thumb reveal-blk"
									:style="{ animationDelay: d(index, 5) }"
									:src="n._wallpaperUrl"
									mode="aspectFill"
								></image>
							</view>
					</swipe-cell>

					<view v-if="loading" class="loading-tip">加载中...</view>
					<view v-else-if="hasMore" class="loading-tip" @click="loadMore">加载更多</view>
				</view>

				<!-- 空态：骨架移除后再展示，避免与骨架重叠 -->
				<empty-state v-if="!skVisible && !list.length" icon="checkmarkempty" icon-color="#a7bfd3" text="还没有消息" :top="160" />

				<!-- 骨架屏：头像 + 两行文字 + 时间 + 缩略图，共用一道斜向光带 -->
				<view v-if="skVisible" class="sk-layer" :class="{ 'sk-out': skFading }">
					<view class="msg-list">
						<view class="swipe-item" v-for="i in 6" :key="i">
							<view class="msg-item">
								<view class="avatar-wrap">
									<view class="avatar sk"></view>
								</view>
								<view class="msg-body">
									<view class="sk sk-line"></view>
									<view class="sk sk-line short"></view>
									<view class="sk sk-line sk-time"></view>
								</view>
								<view class="msg-thumb sk"></view>
							</view>
						</view>
					</view>
					<view class="sk-shine"></view>
				</view>
			</view>
		</template>
	</view>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { onShow, onReachBottom } from '@dcloudio/uni-app';
import { resolveFileUrls } from '../../utils/cloud-file';
import { formatTime } from '../../utils/format-time';
import { callMessage } from '../../utils/message';
import { useSkeleton } from '../../utils/skeleton';
import { useMessageStore } from '../../store/message';
import { useUserStore } from '../../store/user';
import { storeToRefs } from 'pinia';
import { useAppConfigStore } from '../../store/app-config';

const PROMPT_KEY = 'subscribe_prompted_v1';

// 全局开关：true 时隐藏评论相关内容（含回复订阅入口）
const appStore = useAppConfigStore();
const { hideContent: hideComments } = storeToRefs(appStore);

// 登录态：从全局 store 响应式读取，登录/登出自动同步
const userStore = useUserStore();
const { isLogin } = storeToRefs(userStore);

// 未读角标：拉取未读数并同步消息 tab 角标
const messageStore = useMessageStore();

const list = ref<any[]>([]);
const loading = ref(false);
const hasMore = ref(false);
// 分页游标按服务端原始条数推进：删除通知后同步回退，避免后续分页漏一条
const PAGE_SIZE = 20;
let rawSkip = 0;
// 请求序号：onShow 重置刷新时丢弃仍在飞行中的旧响应
let reqId = 0;
const templateId = ref('');
const remain = ref(0); // 当前剩余可接收的微信通知条数（一次性订阅，授权1次+1，下发1条-1）
const subscribing = ref(false);
const promptedRef = { done: false }; // 本次冷启动内只弹一次

// 骨架屏：首屏加载中显示，数据到达后淡出并与内容错位浮现交错
const { skVisible, skFading, skDone } = useSkeleton();

// 内容块依次浮现的延迟：消息按序号错开（前 5 条封顶），消息内各块再按 60ms 递增
function d(index: number, step: number): string {
	return Math.min(index, 5) * 60 + step * 60 + 'ms';
}

const subDescText = computed(() => {
	if (!isLogin.value) return '登录后可开启评论回复的微信提醒';
	if (remain.value > 0) return `当前可接收 ${remain.value} 条回复提醒，可继续累积`;
	return '评论被回复时微信提醒你，每授权1次可收1条';
});
const subBtnText = computed(() => {
	if (!isLogin.value) return '去登录';
	return remain.value > 0 ? '再加1条' : '去开启';
});

onShow(() => {
	refreshSubInfo();
	if (!isLogin.value) {
		list.value = [];
		skDone(); // 未登录不加载列表，也要让骨架消失
		messageStore.refreshBadge();
		return;
	}
	loadList(true);
	messageStore.refreshBadge();
	if (!hideComments.value) initSubscribePrompt();
});

onReachBottom(() => {
	if (hasMore.value && !loading.value) loadMore();
});

onUnmounted(() => {
	uni.$off('loginSuccess', onLoginSuccess);
});

function onLoginSuccess() {
	loadList(true);
	messageStore.refreshBadge();
	refreshSubInfo();
	if (!hideComments.value) initSubscribePrompt();
}
uni.$on('loginSuccess', onLoginSuccess);

async function loadList(reset: boolean = false) {
	// 重置刷新可越过 loading 守卫，并让旧请求结果失效
	if (reset) {
		reqId++;
		rawSkip = 0;
	}
	const seq = reqId;
	if (loading.value && !reset) return;
	loading.value = true;
	try {
		const res = await callMessage('notifications', { skip: rawSkip });
		if (seq !== reqId) return;
		if (res.errCode !== 0) {
			uni.showToast({ title: res.errMsg || '消息加载失败', icon: 'none' });
			return;
		}
		const rows = res.list || [];
		// 批量换取回复者头像与照片缩略图
		const fileIds = [];
		rows.forEach((n) => {
			if (n.from && n.from.avatar) fileIds.push(n.from.avatar);
			if (n.wallpaper_image) fileIds.push(n.wallpaper_image);
		});
		const urlMap = await resolveFileUrls(fileIds);
		if (seq !== reqId) return;
		const mapped = rows.map((n) => ({
			...n,
			_avatarUrl: n.from && n.from.avatar ? urlMap[n.from.avatar] || '' : '',
			_wallpaperUrl: n.wallpaper_image ? urlMap[n.wallpaper_image] || '' : ''
		}));
		list.value = reset ? mapped : list.value.concat(mapped);
		rawSkip += PAGE_SIZE;
		hasMore.value = !!res.hasMore;
	} catch (e) {
		if (seq !== reqId) return;
		uni.showToast({ title: '消息加载失败', icon: 'none' });
	} finally {
		if (seq === reqId) {
			loading.value = false;
			skDone(); // 无论成功失败都让骨架淡出，避免卡在加载态
		}
	}
}

function loadMore() {
	loadList(false);
}

// 通知类型 → 动作文案
function actionText(type: string): string {
	if (type === 'comment') return ' 评论了你的照片';
	if (type === 'like') return ' 赞了你的照片';
	if (type === 'audit') return ' 系统通知';
	return ' 回复了你';
}

async function openNoti(n: any) {
	// 未读先置已读并立即刷新角标，再跳详情（不阻塞跳转）
	if (!n.is_read) {
		n.is_read = 1;
		messageStore.refreshBadge();
		try {
			await callMessage('markRead', { notiId: n._id });
		} catch (e) {}
	}
	if (n.wallpaper_id) {
		uni.navigateTo({ url: '/pages/Detail/detail?id=' + n.wallpaper_id });
	}
}

async function onMarkAllRead() {
	if (!list.value.some((n) => !n.is_read)) {
		uni.showToast({ title: '没有未读消息', icon: 'none' });
		return;
	}
	try {
		const res = await callMessage('markAllRead');
		if (res.errCode !== 0) {
			uni.showToast({ title: res.errMsg || '操作失败', icon: 'none' });
			return;
		}
		list.value.forEach((n) => { n.is_read = 1; });
		messageStore.refreshBadge();
		uni.showToast({ title: '已全部已读', icon: 'success' });
	} catch (e) {
		uni.showToast({ title: '网络异常，请重试', icon: 'none' });
	}
}

/* ============ 左滑删除：交互由 swipe-cell 组件处理 ============ */
const msgActions = [{ key: 'delete', label: '删除', type: 'delete' }];

function onSwipeAction(key: string, n: any) {
	if (key === 'delete') deleteNoti(n);
}

async function deleteNoti(n: any) {
	uni.showLoading({ title: '删除中…', mask: true });
	try {
		const res = await callMessage('deleteNotification', { notiId: n._id });
		if (res.errCode !== 0) {
			uni.showToast({ title: res.errMsg || '删除失败', icon: 'none' });
			return;
		}
		list.value = list.value.filter((i) => i._id !== n._id);
		// 服务端数据同步减少一条，游标回退，避免下次分页跳过一条
		rawSkip = Math.max(0, rawSkip - 1);
		messageStore.refreshBadge(); // 删的可能是未读，刷新 tab 角标
	} catch (e) {
		uni.showToast({ title: '网络异常，请重试', icon: 'none' });
	} finally {
		uni.hideLoading();
	}
}

/* ============ 微信一次性订阅消息 ============ */

// 拉取订阅模板与剩余条数（进页面/登录后/授权后刷新）
async function refreshSubInfo() {
	try {
		const res = await callMessage('subscribeInfo');
		templateId.value = (res && res.templateId) || '';
		remain.value = (res && res.remain) || 0;
	} catch (e) {
		templateId.value = '';
		remain.value = 0;
	}
}

function onSubCardClick() {
	if (subscribing.value) return;
	if (!isLogin.value) return goLogin();
	requestSubscribe(false);
}

async function initSubscribePrompt() {
	if (promptedRef.done) return;
	await refreshSubInfo();
	if (!templateId.value) return;

	// 本次冷启动内首次进入且本地未记录过，弹窗询问是否订阅
	if (uni.getStorageSync(PROMPT_KEY)) {
		promptedRef.done = true;
		return;
	}
	promptedRef.done = true;
	uni.setStorageSync(PROMPT_KEY, 1);

	uni.showModal({
		title: '开启消息通知',
		content: '当你的评论被他人回复时，可通过微信服务通知第一时间收到提醒。\n（微信为一次性订阅，每授权一次可接收1条通知，可随时再次开启）',
		confirmText: '开启',
		cancelText: '暂不',
		success: (r) => {
			if (r.confirm) requestSubscribe(true);
		}
	});
}

function requestSubscribe(fromModal: boolean) {
	if (subscribing.value || !templateId.value) return;
	// #ifdef MP-WEIXIN
	subscribing.value = true;
	uni.requestSubscribeMessage({
		tmplIds: [templateId.value],
		success: async (res) => {
			const state = res && res[templateId.value];
			if (state === 'accept') {
				try {
					const r = await callMessage('saveSubscribe');
					if (r.errCode === 0) {
						remain.value = (typeof r.remain === 'number' ? r.remain : remain.value + 1);
						uni.showToast({ title: `已开启，还可接收${remain.value}条提醒`, icon: 'none' });
					} else {
						uni.showToast({ title: r.errMsg || '开启失败', icon: 'none' });
					}
				} catch (e) {
					uni.showToast({ title: '网络异常，请重试', icon: 'none' });
				}
			} else if (state === 'reject' && !fromModal) {
				uni.showToast({ title: '已取消授权', icon: 'none' });
			}
			// ban：被后台封禁订阅能力，requestSubscribeMessage 会走 fail
		},
		fail: (err) => {
			const msg = (err && err.errMsg) || '';
			if (msg.indexOf('ban') !== -1) {
				uni.showModal({
					title: '无法开启',
					content: '你已关闭该小程序的订阅消息权限，可在微信「设置-订阅消息」中重新开启。',
					showCancel: false
				});
			} else if (!fromModal) {
				uni.showToast({ title: '授权失败，请重试', icon: 'none' });
			}
		},
		complete: () => {
			subscribing.value = false;
		}
	});
	// #endif
}

function goLogin() {
	uni.navigateTo({ url: '/pages/Login/login' });
}

</script>

<style lang="scss" scoped>
	.page {
		min-height: 100vh;
		background: #f4f6f9;
		padding-bottom: 40rpx;
	}

	/* 订阅入口卡片 */
	.sub-card {
		display: none; // 微信回复提醒卡片暂时隐藏（订阅消息功能暂时下线）
		margin: 20rpx;
		padding: 24rpx;
		background: #fff;
		border-radius: 20rpx;
		box-shadow: 0 6rpx 20rpx rgba(31, 95, 174, 0.06);
		// display: flex; 恢复显示时取消本行注释并删掉上面的 display:none
		align-items: center;
		justify-content: space-between;

		.sub-left {
			display: flex;
			align-items: center;
			flex: 1;
			min-width: 0;
		}

		.sub-text {
			margin-left: 16rpx;
			display: flex;
			flex-direction: column;

			.sub-title {
				font-size: 28rpx;
				font-weight: bold;
				color: #2b3a4a;
			}

			.sub-desc {
				margin-top: 6rpx;
				font-size: 22rpx;
				color: #8a97a6;
			}
		}

		.sub-btn {
			flex-shrink: 0;
			margin-left: 20rpx;
			padding: 0 28rpx;
			height: 60rpx;
			line-height: 60rpx;
			border-radius: 30rpx;
			background: linear-gradient(90deg, #4facfe 0%, #2c98e7 100%);
			color: #fff;
			font-size: 24rpx;

			&.disabled {
				opacity: 0.5;
			}
		}
	}

	.list-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8rpx 28rpx 16rpx;

		.list-head-title {
			font-size: 28rpx;
			font-weight: bold;
			color: #2b3a4a;
		}

		.read-all {
			font-size: 24rpx;
			color: #5a8fc2;
		}
	}

	.msg-list {
		padding: 0 20rpx;
	}

	.feed {
		position: relative;
	}

	/* 加载期撑住高度：骨架层绝对定位不占位，避免塌陷跳动 */
	.feed-loading {
		min-height: 900rpx;
	}

	/* 骨架层底色跟随本页页面底色，避免淡出时出现色差闪白 */
	.sk-layer {
		background: #f4f6f9;
	}

	/* 骨架文字行 */
	.sk-line {
		height: 26rpx;
		width: 90%;
		border-radius: 8rpx;
		margin-top: 16rpx;

		&.short {
			width: 55%;
		}
	}

	/* 骨架时间行：比正文更短更细 */
	.sk-time {
		height: 20rpx;
		width: 30%;
		margin-top: 10rpx;
	}

	/* 左滑骨架行：真实消息的左滑交互见 components/swipe-cell */
	.swipe-item {
		position: relative;
		margin-bottom: 16rpx;
		border-radius: 20rpx;
		overflow: hidden;
	}

	.msg-item {
		display: flex;
		align-items: flex-start;
		background: #fff;
		border-radius: 20rpx;
		padding: 24rpx;
		box-shadow: 0 6rpx 20rpx rgba(31, 95, 174, 0.05);

		.avatar-wrap {
			position: relative;
			flex-shrink: 0;

			.avatar {
				width: 80rpx;
				height: 80rpx;
				border-radius: 50%;
			}

			.avatar-default {
				width: 80rpx;
				height: 80rpx;
				border-radius: 50%;
				background: #eef2f7;
				display: flex;
				align-items: center;
				justify-content: center;
			}

			.unread-dot {
				position: absolute;
				top: -4rpx;
				right: -4rpx;
				width: 18rpx;
				height: 18rpx;
				border-radius: 50%;
				background: #ff4d5e;
				border: 3rpx solid #fff;
				box-sizing: content-box;
			}
		}

		.msg-body {
			margin-left: 18rpx;
			flex: 1;
			min-width: 0;
			display: flex;
			flex-direction: column;

			.msg-line {
				.msg-name {
					font-size: 26rpx;
					font-weight: bold;
					color: #2b3a4a;
				}

				.msg-action {
					font-size: 24rpx;
					color: #8a97a6;
				}
			}

			.msg-content {
				margin-top: 8rpx;
				font-size: 28rpx;
				line-height: 1.5;
				color: #4a5868;
				word-break: break-all;
				display: -webkit-box;
				-webkit-box-orient: vertical;
				-webkit-line-clamp: 2;
				overflow: hidden;
			}

			.msg-time {
				margin-top: 10rpx;
				font-size: 22rpx;
				color: #b6c0cc;
			}
		}

		.msg-thumb {
			flex-shrink: 0;
			width: 84rpx;
			height: 90rpx;
			border-radius: 10rpx;
			margin-left: 16rpx;
			background: #eef2f7;
		}

		&.unread {
			background: #f3f8ff;
		}
	}

	.loading-tip {
		padding: 24rpx 0;
		text-align: center;
		font-size: 24rpx;
		color: #8fb6d6;
	}

	.login-tip {
		padding: 160rpx 0 60rpx;
		display: flex;
		flex-direction: column;
		align-items: center;

		.login-tip-text {
			margin-top: 24rpx;
			font-size: 26rpx;
			color: #a7bfd3;
		}

		.login-btn {
			margin-top: 32rpx;
			padding: 0 64rpx;
			height: 72rpx;
			line-height: 72rpx;
			border-radius: 36rpx;
			background: linear-gradient(90deg, #4facfe 0%, #2c98e7 100%);
			color: #fff;
			font-size: 28rpx;
		}
	}
</style>
