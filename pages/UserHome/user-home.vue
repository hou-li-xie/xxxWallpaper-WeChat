<template>
	<view class="page">
		<!-- 用户信息头 -->
		<view class="user-header">
			<view class="user-card">
				<image v-if="user.avatar" class="avatar" :src="avatarUrl" mode="aspectFill"></image>
				<view v-else class="avatar avatar-default">
					<uni-icons type="person-filled" size="44" color="#9bb8d3"></uni-icons>
				</view>
				<view class="user-meta">
					<view class="nickname">{{ user.nickname || '用户' }}</view>
					<view class="subtitle">已发布 {{ photoCount }} 张照片</view>
				</view>
			</view>
		</view>

		<!-- 照片瀑布流：骨架层绝对定位覆盖其上，加载期给容器撑高避免塌陷跳动 -->
		<view class="feed" :class="{ 'feed-loading': skVisible }">
			<!-- 空态：骨架移除后再展示，避免与骨架重叠 -->
			<view v-if="!skVisible && !list.length" class="empty">
				<uni-icons type="image" size="46" color="#bcd0e2"></uni-icons>
				<text class="empty-text">TA 还没有发布照片</text>
			</view>

			<!-- 照片瀑布流：两列，按真实宽高比分配高度 -->
			<view class="masonry">
				<view class="m-col" v-for="(col, ci) in [leftCol, rightCol]" :key="ci">
					<view
						class="m-item reveal-blk"
						v-for="(item, index) in col"
						:key="item._id"
						:style="{ animationDelay: d(index * 2 + ci, 0) }"
						@click="goDetail(item._id)"
					>
						<image :src="item._imgUrl" mode="aspectFill" lazy-load :style="{ height: item._h + 'rpx' }"></image>
						<view v-if="item.description" class="m-label reveal-blk" :style="{ animationDelay: d(index * 2 + ci, 1) }">{{ item.description }}</view>
					</view>
				</view>
			</view>

			<view v-if="list.length" class="loadmore">{{ loadmoreText }}</view>

			<!-- 骨架屏：瀑布流形状与真实内容一致（两列不等高卡片），共用一道斜向光带 -->
			<view v-if="skVisible" class="sk-layer" :class="{ 'sk-out': skFading }">
				<view class="masonry">
					<view class="m-col">
						<view class="m-item sk" v-for="(h, i) in [460, 380, 500]" :key="'l' + i" :style="{ height: h + 'rpx' }"></view>
					</view>
					<view class="m-col">
						<view class="m-item sk" v-for="(h, i) in [400, 520, 360]" :key="'r' + i" :style="{ height: h + 'rpx' }"></view>
					</view>
				</view>
				<view class="sk-shine"></view>
			</view>
		</view>
	</view>
</template>

<script setup lang="ts">
	import { ref, computed } from 'vue';
	import { onLoad, onReachBottom, onPullDownRefresh, onShareAppMessage } from '@dcloudio/uni-app';
	import { resolveFileUrl, resolveFileUrls } from '../../utils/cloud-file';
	import { useSkeleton } from '../../utils/skeleton';

	const user = ref<Record<string, any>>({ _id: '', nickname: '', avatar: '' });
	const avatarUrl = ref('');
	const list = ref<any[]>([]);
	const loading = ref(false);
	const hasMore = ref(false);
	const photoCount = ref(0);
	let targetUid = '';

	// 骨架屏：首屏加载中显示，数据到达后淡出并与内容错位浮现交错
	const { skVisible, skFading, skDone } = useSkeleton();

	// 内容块依次浮现的延迟：卡片按序号错开（前 5 张封顶），卡片内各块再按 60ms 递增
	function d(index: number, step: number): string {
		return Math.min(index, 5) * 60 + step * 60 + 'ms';
	}

	// 瀑布流两列（与首页一致的分配策略：按真实宽高比算高度，放入当前较矮列）
	const COL_WIDTH = 350; // (750 - 20*2 padding - 10 gap) / 2
	const leftCol = ref<any[]>([]);
	const rightCol = ref<any[]>([]);
	let leftH = 0;
	let rightH = 0;

	function calcH(item: any): number {
		const w = Number(item.width) || 375;
		const h = Number(item.height) || 400;
		let vh = COL_WIDTH * (h / w);
		// 钳制：极端全景/长图不至于塌成一条或顶穿屏幕
		vh = Math.max(COL_WIDTH * 0.75, Math.min(COL_WIDTH * 2.2, vh));
		return Math.round(vh);
	}

	function assignItems(items: any[]) {
		items.forEach((item) => {
			item._h = calcH(item);
			if (leftH <= rightH) {
				leftCol.value.push(item);
				leftH += item._h;
			} else {
				rightCol.value.push(item);
				rightH += item._h;
			}
		});
	}

	const loadmoreText = computed(() => {
		if (loading.value) return '加载中…';
		return hasMore.value ? '上拉加载更多' : '没有更多了';
	});

	onLoad((options: any) => {
		targetUid = (options && options.uid) || '';
		if (!targetUid) {
			uni.showToast({ title: '缺少用户ID', icon: 'none' });
			return;
		}
		reload();
	});

	// 页面分享：分享 TA 的主页
	onShareAppMessage(() => ({
		title: (user.value.nickname || 'TA') + ' 的主页',
		path: '/pages/UserHome/user-home?uid=' + targetUid,
		imageUrl: avatarUrl.value || '/static/logo.jpeg'
	}));

	onReachBottom(() => {
		if (hasMore.value && !loading.value) loadMore();
	});

	onPullDownRefresh(async () => {
		await reload();
		uni.stopPullDownRefresh();
	});

	async function reload() {
		list.value = [];
		leftCol.value = [];
		rightCol.value = [];
		leftH = 0;
		rightH = 0;
		hasMore.value = false;
		user.value = { _id: '', nickname: '', avatar: '' };
		avatarUrl.value = '';
		photoCount.value = 0;
		await loadMore();
		// 换头像
		if (user.value.avatar) {
			try {
				avatarUrl.value = await resolveFileUrl(user.value.avatar);
			} catch (e) {}
		}
	}

	async function loadMore() {
		if (loading.value) return;
		loading.value = true;
		try {
			const res = await uniCloud.callFunction({
				name: 'wallpaper-action',
				data: { action: 'userHome', targetUid, skip: list.value.length }
			});
			const r = res.result || {};
			if (r.errCode) {
				uni.showToast({ title: r.errMsg || '加载失败', icon: 'none' });
				return;
			}
			if (r.user) {
				user.value = r.user;
				photoCount.value = r.photoCount || 0;
			}
			const records = r.list || [];
			const urlMap = await resolveFileUrls(records.map((i) => i.image).filter(Boolean));
			const mapped = records.map((i) => ({
				...i,
				_imgUrl: urlMap[i.image] || ''
			}));
			list.value = list.value.concat(mapped);
			assignItems(mapped);
			hasMore.value = !!r.hasMore;
		} catch (e) {
			console.error('用户主页加载失败', e);
			uni.showToast({ title: '加载失败，请重试', icon: 'none' });
		} finally {
			loading.value = false;
			skDone(); // 无论成功失败都让骨架淡出，避免卡在加载态
		}
	}

	function goDetail(id: string) {
		if (!id) return;
		uni.navigateTo({ url: '/pages/Detail/detail?id=' + id });
	}
</script>

<style lang="scss">
	.page {
		min-height: 100vh;
		background: #f5f7fa;
	}

	.feed {
		position: relative;
	}

	/* 加载期撑住高度：骨架层绝对定位不占位，避免塌陷跳动 */
	.feed-loading {
		min-height: 1400rpx;
	}

	.user-header {
		padding: 40rpx 30rpx 30rpx;
		background-image: linear-gradient(120deg, #a1c4fd 0%, #c2e9fb 100%);

		.user-card {
			display: flex;
			align-items: center;
			padding: 32rpx 30rpx;
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

				.subtitle {
					margin-top: 10rpx;
					font-size: 26rpx;
					color: #7a93ab;
				}
			}
		}
	}

	/* 瀑布流：两列，高度按图片比例 */
	.masonry {
		display: flex;
		align-items: flex-start;
		padding: 20rpx;
		gap: 10rpx;

		.m-col {
			width: 350rpx;
			display: flex;
			flex-direction: column;
			gap: 10rpx;
		}

		.m-item {
			position: relative;
			border-radius: 16rpx;
			overflow: hidden;
			background: #eef4fa;

			image {
				width: 100%;
				display: block;
			}

			.m-label {
				position: absolute;
				left: 0;
				right: 0;
				bottom: 0;
				padding: 8rpx 12rpx;
				font-size: 22rpx;
				color: #fff;
				background: linear-gradient(to top, rgba(0, 0, 0, 0.45), transparent);
				overflow: hidden;
				white-space: nowrap;
				text-overflow: ellipsis;
			}
		}
	}

	.loadmore {
		padding: 20rpx 0 40rpx;
		text-align: center;
		font-size: 24rpx;
		color: #a7bfd3;
	}

	.empty {
		padding-top: 140rpx;
		display: flex;
		flex-direction: column;
		align-items: center;

		.empty-text {
			margin-top: 20rpx;
			font-size: 28rpx;
			color: #9bb4c9;
		}
	}
</style>
