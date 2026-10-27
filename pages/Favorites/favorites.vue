<template>
	<view class="page">
		<!-- 骨架层绝对定位覆盖其上，加载期给容器撑高避免塌陷跳动 -->
		<view class="feed" :class="{ 'feed-loading': skVisible }">
			<!-- 空态：骨架移除后再展示，避免与骨架重叠 -->
			<view v-if="!skVisible && !list.length" class="empty">
				<uni-icons type="star" size="46" color="#bcd0e2"></uni-icons>
				<text class="empty-text">还没有收藏照片</text>
				<button class="go-home" @click="goHome">去逛逛</button>
			</view>

			<view class="list">
				<!-- 数据到达后：卡片 → 图片 → 标题 → 时间 → 数据行，依次浮现 -->
				<view
					class="card reveal-blk"
					v-for="(item, index) in list"
					:key="item._favId"
					:style="{ animationDelay: d(index, 0) }"
					@click="goDetail(item._id)"
				>
					<view class="thumb reveal-blk" :style="{ animationDelay: d(index, 1) }">
						<image :src="item._imgUrl" mode="aspectFill" lazy-load></image>
					</view>
					<view class="meta">
						<view class="desc reveal-blk" :style="{ animationDelay: d(index, 2) }">{{ item.description || '（未填写描述）' }}</view>
						<view class="time reveal-blk" :style="{ animationDelay: d(index, 3) }">收藏于 {{ formatTime(item._favTime) }}</view>
						<view class="stats reveal-blk" :style="{ animationDelay: d(index, 4) }">
							<uni-icons type="hand-up" size="15" color="#8fb6d6"></uni-icons>
							<text>{{ (item.info && item.info.likeNum) || 0 }}</text>
							<!-- 评论数（随 hide_content 开关隐藏） -->
							<template v-if="!hideComments">
								<uni-icons type="chatbubble" size="15" color="#8fb6d6"></uni-icons>
								<text>{{ (item.info && item.info.commentNum) || 0 }}</text>
							</template>
							<text class="view-detail">查看详情 ›</text>
						</view>
					</view>
				</view>
			</view>

			<view v-if="list.length" class="loadmore">{{ loadmoreText }}</view>

			<!-- 骨架屏：卡片形状与真实内容一致（缩略图 + 三行文字），共用一道斜向光带 -->
			<view v-if="skVisible" class="sk-layer" :class="{ 'sk-out': skFading }">
				<view class="list">
					<view class="card" v-for="i in 5" :key="i">
						<view class="thumb sk"></view>
						<view class="meta">
							<view class="sk sk-line"></view>
							<view class="sk sk-line short"></view>
							<view class="sk sk-line short"></view>
						</view>
					</view>
				</view>
				<view class="sk-shine"></view>
			</view>
		</view>
	</view>
</template>

<script setup lang="ts">
	import { ref, computed, onUnmounted } from 'vue';
	import { onLoad, onReachBottom, onPullDownRefresh } from '@dcloudio/uni-app';
	import { isLoggedIn } from '../../utils/auth';
	import { resolveFileUrls } from '../../utils/cloud-file';
	import { useSkeleton } from '../../utils/skeleton';
	import { storeToRefs } from 'pinia';
	import { useAppConfigStore } from '../../store/app-config';

	// 评论开关：true=隐藏评论数（app_config.hide_content 控制，默认隐藏兜底）
	const appStore = useAppConfigStore();
	const { hideContent: hideComments } = storeToRefs(appStore);

	const list = ref<any[]>([]);
	const loading = ref(false);
	const hasMore = ref(false);

	// 骨架屏：首屏加载中显示，数据到达后淡出并与内容错位浮现交错
	const { skVisible, skFading, skDone } = useSkeleton();

	// 内容块依次浮现的延迟：卡片按序号错开（前 5 张封顶），卡片内各块再按 60ms 递增
	function d(index: number, step: number): string {
		return Math.min(index, 5) * 60 + step * 60 + 'ms';
	}

	const loadmoreText = computed(() => {
		if (loading.value) return '加载中…';
		return hasMore.value ? '上拉加载更多' : '没有更多了';
	});

	onLoad(() => {
		if (!isLoggedIn()) {
			uni.redirectTo({ url: '/pages/Login/login' });
			return;
		}
		reload();
	});

	onReachBottom(() => {
		if (hasMore.value && !loading.value) loadMore();
	});

	onPullDownRefresh(async () => {
		await reload();
		uni.stopPullDownRefresh();
	});

	// 详情页点赞/评论变更 → 原地同步列表内对应照片数量
	function onStatsChanged(e: { id: string; likeNum?: number; commentNum?: number }) {
		list.value.forEach((item) => {
			if (item._id !== e.id) return;
			if (!item.info) item.info = {};
			if (typeof e.likeNum === 'number') item.info.likeNum = e.likeNum;
			if (typeof e.commentNum === 'number') item.info.commentNum = e.commentNum;
		});
	}
	uni.$on('photoStatsChanged', onStatsChanged);

	onUnmounted(() => {
		uni.$off('photoStatsChanged', onStatsChanged);
	});

	async function reload() {
		list.value = [];
		hasMore.value = false;
		await loadMore();
	}

	async function loadMore() {
		if (loading.value) return;
		loading.value = true;
		try {
			const res = await uniCloud.callFunction({
				name: 'wallpaper-action',
				data: { action: 'favoriteList', skip: list.value.length }
			});
			const r = res.result || {};
			if (r.errCode) {
				uni.showToast({ title: r.errMsg || '加载失败', icon: 'none' });
				return;
			}
			const records: any[] = r.list || [];
			const urlMap = await resolveFileUrls(records.map((i) => i.image).filter(Boolean));
			const mapped = records.map((i) => ({
				...i,
				// _favId 即收藏记录 _id，create_time 已在服务端按收藏时间排序；这里取回展示
				_favTime: i.createTime,
				_imgUrl: urlMap[i.image] || ''
			}));
			list.value = list.value.concat(mapped);
			hasMore.value = !!r.hasMore;
		} catch (e) {
			console.error('收藏列表加载失败', e);
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

	function goHome() {
		uni.switchTab({ url: '/pages/Home/index' });
	}

	function formatTime(ts: any): string {
		if (!ts) return '';
		const d = new Date(Number(ts));
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
		min-height: 1420rpx;
	}

	.list {
		padding: 24rpx;
	}

	/* 骨架文字行 */
	.sk-line {
		height: 26rpx;
		width: 90%;
		margin-top: 16rpx;

		&.short {
			width: 55%;
		}
	}

	.card {
		display: flex;
		background: #fff;
		border-radius: 20rpx;
		padding: 20rpx;
		margin-bottom: 20rpx;
		box-shadow: 0 4rpx 16rpx rgba(56, 151, 228, 0.05);

		.thumb {
			width: 188rpx;
			height: 200rpx;
			border-radius: 12rpx;
			overflow: hidden;
			background: #eef4fa;
			flex-shrink: 0;

			image {
				width: 100%;
				height: 100%;
			}
		}

		.meta {
			flex: 1;
			margin-left: 22rpx;
			display: flex;
			flex-direction: column;
			justify-content: space-between;
			min-width: 0;

			.desc {
				font-size: 28rpx;
				color: #333;
				line-height: 1.5;
				display: -webkit-box;
				-webkit-box-orient: vertical;
				-webkit-line-clamp: 2;
				overflow: hidden;
			}

			.time {
				font-size: 22rpx;
				color: #a7bfd3;
				margin-top: 8rpx;
			}

			.stats {
				display: flex;
				align-items: center;
				gap: 8rpx;
				margin-top: 8rpx;
				font-size: 22rpx;
				color: #8fb6d6;

				.view-detail {
					margin-left: auto;
					color: #3897e4;
				}
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
		padding-top: 180rpx;
		display: flex;
		flex-direction: column;
		align-items: center;

		.empty-text {
			margin-top: 20rpx;
			font-size: 28rpx;
			color: #9bb4c9;
		}

		.go-home {
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
	}
</style>
