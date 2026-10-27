<template>
	<view class="page">
		<!-- 榜单切换 -->
		<view class="tabs">
			<view
				v-for="tab in tabs"
				:key="tab.value"
				class="tab"
				:class="{ active: rankType === tab.value }"
				@click="switchTab(tab.value)"
			>
				{{ tab.label }}
			</view>
		</view>

		<view class="feed" :class="{ 'feed-loading': skVisible }">
			<!-- 空态：骨架移除后再展示，避免与骨架重叠 -->
			<view v-if="!skVisible && !list.length" class="empty">
				<uni-icons type="trophy" size="46" color="#bcd0e2"></uni-icons>
				<text class="empty-text">还没有上榜照片</text>
			</view>

			<view v-else class="list">
				<!-- 数据到达后：卡片 → 图片 → 标题 → 头像 → 名称 → 计数，依次浮现 -->
				<view
					class="card reveal-blk"
					v-for="(item, index) in list"
					:key="item._id"
					:style="{ animationDelay: d(index, 0) }"
					@click="goDetail(item._id)"
				>
					<view class="rank-no" :class="'rank-' + (index + 1)">
						<view v-if="index < 3" class="medal-box">
							<uni-icons type="trophy-filled" size="18" :color="medalColor[index]"></uni-icons>
							<text class="medal-num">{{ index + 1 }}</text>
						</view>
						<text v-else>{{ index + 1 }}</text>
					</view>
					<view class="thumb reveal-blk" :style="{ animationDelay: d(index, 1) }">
						<image :src="item._imgUrl" mode="aspectFill" lazy-load></image>
					</view>
					<view class="meta">
						<view class="desc reveal-blk" :style="{ animationDelay: d(index, 2) }">{{ item.description || '该用户什么也没留下....' }}</view>
						<view class="author">
							<image v-if="item._avatarUrl" class="avatar reveal-blk" :style="{ animationDelay: d(index, 3) }" :src="item._avatarUrl" mode="aspectFill"></image>
							<text class="name reveal-blk" :style="{ animationDelay: d(index, 4) }">{{ (item.author && item.author.name) || '匿名' }}</text>
						</view>
					</view>
					<view class="count reveal-blk" :style="{ animationDelay: d(index, 5) }">
						<uni-icons
							:type="rankType === 'like' ? 'hand-up-filled' : rankType === 'view' ? 'eye-filled' : 'chatbubble-filled'"
							size="16"
							:color="rankType === 'like' ? '#f06292' : rankType === 'view' ? '#43b8a0' : '#2c98e7'"
						></uni-icons>
						<text>{{ countOf(item) }}</text>
					</view>
				</view>
			</view>

			<!-- 骨架屏：卡片形状与真实内容一致（名次 + 缩略图 + 两行文字 + 计数），共用一道斜向光带 -->
			<view v-if="skVisible" class="sk-layer" :class="{ 'sk-out': skFading }">
				<view class="list">
					<view class="card" v-for="i in 6" :key="i">
						<view class="rank-no"><view class="sk sk-rank"></view></view>
						<view class="thumb sk"></view>
						<view class="meta">
							<view class="sk sk-line"></view>
							<view class="sk sk-line short"></view>
						</view>
						<view class="count sk sk-count"></view>
					</view>
				</view>
				<view class="sk-shine"></view>
			</view>
		</view>
	</view>
</template>

<script setup lang="ts">
	import { ref, computed } from 'vue';
	import { onLoad, onShareAppMessage } from '@dcloudio/uni-app';
	import { resolveFileUrls } from '../../utils/cloud-file';
	import { useSkeleton } from '../../utils/skeleton';
	import { storeToRefs } from 'pinia';
	import { useAppConfigStore } from '../../store/app-config';

	// 评论开关：true=隐藏评论榜 tab（app_config.hide_content 控制，默认隐藏兜底）
	const appStore = useAppConfigStore();
	const { hideContent: hideComments } = storeToRefs(appStore);

	const tabs = computed(() => {
		const list = [
			{ label: '点赞榜', value: 'like' },
			{ label: '浏览榜', value: 'view' }
		];
		if (!hideComments.value) list.push({ label: '评论榜', value: 'comment' });
		return list;
	});
	// 前三名奖牌色：金/银/铜
	const medalColor = ['#f5a623', '#9aa7b4', '#c07b4a'];

	const rankType = ref('like');
	const loading = ref(false);
	const list = ref<any[]>([]);

	// 骨架屏：首屏/切换榜单加载中显示，数据到达后淡出
	const { skVisible, skFading, skDone, skRestart } = useSkeleton();

	// 内容块依次浮现的延迟：卡片按序号错开（前 5 张封顶），卡片内各块再按 60ms 递增
	function d(index: number, step: number): string {
		return Math.min(index, 5) * 60 + step * 60 + 'ms';
	}

	onLoad(() => {
		loadRank();
	});

	// 页面分享：分享排行榜入口
	onShareAppMessage(() => ({
		title: '美照排行榜',
		path: '/pages/Rank/rank',
		imageUrl: '/static/logo.jpeg'
	}));

	function switchTab(value: string) {
		if (rankType.value === value) return;
		rankType.value = value;
		skRestart(); // 切换榜单重新走一次骨架 → 内容浮现
		loadRank();
	}

	function countOf(item: any): number {
		const info = item.info || {};
		if (rankType.value === 'like') return info.likeNum || 0;
		if (rankType.value === 'view') return info.viewNum || 0;
		return info.commentNum || 0;
	}

	async function loadRank() {
		loading.value = true;
		list.value = [];
		try {
			const res = await uniCloud.callFunction({
				name: 'wallpaper-action',
				data: { action: 'ranking', rankType: rankType.value }
			});
			const r = res.result || {};
			if (r.errCode) {
				uni.showToast({ title: r.errMsg || '加载失败', icon: 'none' });
				return;
			}
			const records: any[] = r.list || [];
			const fileIDs: string[] = [];
			records.forEach((item) => {
				if (item.image) fileIDs.push(item.image);
				if (item.author && item.author.avatar) fileIDs.push(item.author.avatar);
			});
			const urlMap = await resolveFileUrls(fileIDs);
			list.value = records.map((item) => ({
				...item,
				_imgUrl: urlMap[item.image] || '',
				_avatarUrl: (item.author && urlMap[item.author.avatar]) || ''
			}));
		} catch (e) {
			console.error('排行榜加载失败', e);
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

	.list {
		padding: 24rpx;
	}

	.card {
		display: flex;
		align-items: center;
		background: #fff;
		border-radius: 20rpx;
		padding: 20rpx;
		margin-bottom: 20rpx;
		box-shadow: 0 4rpx 16rpx rgba(56, 151, 228, 0.05);

		.rank-no {
			width: 64rpx;
			flex-shrink: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 30rpx;
			font-weight: bold;
			color: #8fa5b8;

			/* 前三名：奖杯 + 数字纵向排列 */
			.medal-box {
				display: flex;
				flex-direction: column;
				align-items: center;

				/* 小程序自定义组件宿主默认 inline，在 flex column 中会塌陷，需显式块化 */
				uni-icons {
					display: block;
					line-height: 1;
				}

				.medal-num {
					font-size: 22rpx;
					line-height: 1.2;
					margin-top: 4rpx;
				}
			}

			&.rank-1 .medal-num {
				color: #f5a623;
			}

			&.rank-2 .medal-num {
				color: #9aa7b4;
			}

			&.rank-3 .medal-num {
				color: #c07b4a;
			}
		}

		.thumb {
			width: 150rpx;
			height: 160rpx;
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
			min-width: 0;
			display: flex;
			flex-direction: column;
			justify-content: space-between;

			.desc {
				font-size: 28rpx;
				color: #333;
				line-height: 1.5;
				display: -webkit-box;
				-webkit-box-orient: vertical;
				-webkit-line-clamp: 2;
				overflow: hidden;
			}

			.author {
				display: flex;
				align-items: center;
				margin-top: 12rpx;

				.avatar {
					width: 36rpx;
					height: 36rpx;
					border-radius: 50%;
					background: #eef4fa;
				}

				.name {
					margin-left: 10rpx;
					font-size: 24rpx;
					color: #8fa5b8;
				}
			}
		}

		.count {
			flex-shrink: 0;
			display: flex;
			align-items: center;
			gap: 6rpx;
			margin-left: 16rpx;
			font-size: 26rpx;
			font-weight: bold;
			color: #4a5a6a;
		}
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
	}

	.feed {
		position: relative;
	}

	/* 加载期撑住高度：骨架层绝对定位不占位，避免切换榜单时页面塌陷 */
	.feed-loading {
		min-height: 1280rpx;
	}

	/* 骨架屏形状（灰块底与斜向扫光由全局 .sk / .sk-shine 提供） */
	.sk-rank {
		width: 40rpx;
		height: 32rpx;
		border-radius: 8rpx;
	}

	.sk-line {
		height: 26rpx;
		width: 90%;
		margin-top: 16rpx;

		&.short {
			width: 55%;
		}
	}

	.sk-count {
		width: 56rpx;
		height: 30rpx;
		border-radius: 8rpx;
	}
</style>
