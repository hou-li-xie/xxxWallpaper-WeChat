<template>
	<view class="page">
		<!-- 状态筛选：标签栏样式由 filter-tabs 组件统一提供 -->
		<filter-tabs :tabs="tabs" :model-value="activeStatus" @change="switchTab" />

		<!-- 列表：骨架层绝对定位覆盖其上，加载期给容器撑高避免塌陷跳动 -->
		<view class="feed" :class="{ 'feed-loading': skVisible }">
			<view class="list">
				<!-- 空态：骨架移除后再展示，避免与骨架重叠 -->
				<empty-state
					v-if="!skVisible && !filteredList.length"
					icon="image"
					:text="activeStatus === -1 ? '还没有上传过照片' : '该状态下暂无记录'"
					:button-text="!hideComments && activeStatus === -1 ? '去发布第一张' : ''"
					@action="goPublish"
				/>

				<!-- 左滑卡片：交互与操作按钮由 swipe-cell 组件统一提供 -->
				<swipe-cell
					v-for="(item, index) in filteredList"
					:key="item._id"
					:actions="photoActions"
					:width="280"
					@action="(key) => onSwipeAction(key, item)"
				>
						<!-- 数据到达后：卡片 → 图片 → 描述 → 时间 → 数据行，依次浮现 -->
						<view
							class="card reveal-blk"
							:class="{ 'card-rejected': item.audit_status === 2 }"
							:style="{ animationDelay: d(index, 0) }"
						>
							<view class="thumb reveal-blk" :style="{ animationDelay: d(index, 1) }" @click="preview(item)">
								<image :src="item._imgUrl" mode="aspectFill"></image>
								<!-- 状态角标 -->
								<view class="badge" :class="'badge-' + item.audit_status">
									{{ statusText[item.audit_status] || '待审核' }}
								</view>
							</view>
							<view class="meta" @click="openApproved(item)">
								<view class="desc reveal-blk" :style="{ animationDelay: d(index, 2) }">{{ item.description || '（未填写描述）' }}</view>
								<view class="time reveal-blk" :style="{ animationDelay: d(index, 3) }">{{ formatTime(item.createTime) }}</view>
								<view v-if="item.audit_status === 2 && item.audit_reason" class="reject reveal-blk" :style="{ animationDelay: d(index, 4) }">
									<uni-icons type="info-filled" size="13" color="#e65a5a"></uni-icons>
									<text class="reject-text">{{ item.audit_reason }}</text>
								</view>
								<view v-if="item.audit_status === 1" class="stats reveal-blk" :style="{ animationDelay: d(index, 4) }">
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
				</swipe-cell>
			</view>

			<!-- 骨架屏：卡片形状与真实内容一致（缩略图 + 三行文字），共用一道斜向光带 -->
			<view v-if="skVisible" class="sk-layer" :class="{ 'sk-out': skFading }">
				<view class="list">
					<view class="swipe-item" v-for="i in 5" :key="i">
						<view class="card">
							<view class="thumb sk"></view>
							<view class="meta">
								<view class="sk sk-line"></view>
								<view class="sk sk-line"></view>
								<view class="sk sk-line short"></view>
							</view>
						</view>
					</view>
				</view>
				<view class="sk-shine"></view>
			</view>
		</view>

		<!-- 常驻发布入口（审核期随内容开关隐藏） -->
		<view v-if="!hideComments" class="fab" @click="goPublish">
			<uni-icons type="plusempty" size="34" color="#fff"></uni-icons>
		</view>

		<!-- 编辑描述弹窗 -->
		<view v-if="editVisible" class="edit-mask" @click="editVisible = false">
			<view class="edit-dialog" @click.stop>
				<view class="edit-title">编辑描述</view>
				<textarea
					v-model="editText"
					class="edit-textarea"
					maxlength="100"
					placeholder="描述一下这张照片…"
					auto-height
				/>
				<view class="edit-tip">保存后将重新进入审核，审核通过前不会对外展示修改</view>
				<view class="edit-btns">
					<view class="edit-btn cancel" @click="editVisible = false">取消</view>
					<view class="edit-btn confirm" @click="saveEdit">保存</view>
				</view>
			</view>
		</view>
	</view>
</template>

<script setup lang="ts">
	import { ref, computed, onUnmounted } from 'vue';
	import { onShow, onReachBottom } from '@dcloudio/uni-app';
	import { isLoggedIn } from '../../utils/auth';
	import { resolveFileUrls } from '../../utils/cloud-file';
	import { formatDateTime as formatTime } from '../../utils/format-time';
	import { useSkeleton } from '../../utils/skeleton';
	import { useUserStore } from '../../store/user';
	import { storeToRefs } from 'pinia';
	import { useAppConfigStore } from '../../store/app-config';

	// 评论开关：true=隐藏评论数（app_config.hide_content 控制，默认隐藏兜底）
	const appStore = useAppConfigStore();
	const { hideContent: hideComments } = storeToRefs(appStore);

	// 用户信息：从全局 store 响应式读取
	const userStore = useUserStore();
	const { userInfo } = storeToRefs(userStore);
	const myUid = computed<string>(() => (userInfo.value && userInfo.value._id) || '');

	// -1 全部 / 0 待审核 / 1 已通过 / 2 已驳回
	const tabs = [
		{ label: '全部', value: -1 },
		{ label: '待审核', value: 0 },
		{ label: '已通过', value: 1 },
		{ label: '已驳回', value: 2 }
	];
	const statusText = { 0: '审核中', 1: '已通过', 2: '已驳回' };

	const activeStatus = ref(-1);
	const loading = ref(false);
	const list = ref<any[]>([]);
	const hasMore = ref(false);
	// clientDB 分页：按状态在服务端过滤，避免一次只取前 100 条导致旧数据不可见
	const PAGE_SIZE = 20;
	let rawSkip = 0;
	// 请求序号：onShow 重复刷新时丢弃仍在飞行中的旧响应
	let reqId = 0;

	// 骨架屏：首屏加载中显示，数据到达后淡出并与内容错位浮现交错
	const { skVisible, skFading, skDone } = useSkeleton();

	// 内容块依次浮现的延迟：卡片按序号错开（前 5 张封顶），卡片内各块再按 60ms 递增
	function d(index: number, step: number): string {
		return Math.min(index, 5) * 60 + step * 60 + 'ms';
	}

	// 已按当前状态分页拉取，无需再客户端过滤
	const filteredList = computed(() => list.value);

	onShow(() => {
		if (!isLoggedIn()) {
			uni.redirectTo({ url: '/pages/Login/login?redirect=' + encodeURIComponent('/pages/MyUploads/my-uploads') });
			return;
		}
		reload();
	});

	onReachBottom(() => {
		if (hasMore.value && !loading.value) loadList();
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

	function switchTab(value: number) {
		if (activeStatus.value === value) return;
		activeStatus.value = value;
		reload();
	}

	function reload() {
		reqId++;
		rawSkip = 0;
		list.value = [];
		hasMore.value = false;
		loadList(reqId);
	}

	async function loadList(forceSeq?: number) {
		if (!myUid.value) return;
		const seq = typeof forceSeq === 'number' ? forceSeq : reqId;
		if (seq !== reqId) return;
		// 分页请求需等上一页结束；reload 触发的强制请求可越过该守卫，由序号丢弃旧结果
		if (loading.value && typeof forceSeq !== 'number') return;
		loading.value = true;
		try {
			const db = uniCloud.database();
			// schema 权限保证只能读到本人的记录；状态在服务端过滤，分页才准确
			const where: Record<string, any> = { author_id: myUid.value };
			if (activeStatus.value >= 0) where.audit_status = activeStatus.value;
			const res = await db.collection('wallpapers')
				.where(where)
				.orderBy('createTime', 'desc')
				.skip(rawSkip)
				.limit(PAGE_SIZE)
				.get();
			if (seq !== reqId) return;
			const records = (res.result && res.result.data) || [];

			const urlMap = await resolveFileUrls(records.map((r) => r.image).filter(Boolean));
			if (seq !== reqId) return;
			list.value = list.value.concat(records.map((r) => ({
				...r,
				audit_status: r.audit_status ?? 0,
				info: r.info || { likeNum: 0, commentNum: 0 },
				_imgUrl: urlMap[r.image] || ''
			})));
			rawSkip += PAGE_SIZE;
			hasMore.value = records.length === PAGE_SIZE;
		} catch (e) {
			if (seq !== reqId) return;
			console.error('我的上传加载失败', e);
			uni.showToast({ title: '加载失败，请重试', icon: 'none' });
		} finally {
			if (seq === reqId) {
				loading.value = false;
				skDone(); // 无论成功失败都让骨架淡出，避免卡在加载态
			}
		}
	}

	function preview(item: any) {
		if (!item._imgUrl) return;
		uni.previewImage({
			urls: [item._imgUrl],
			current: item._imgUrl
		});
	}

	function goPublish() {
		uni.navigateTo({ url: '/pages/Publish/publish' });
	}

	function openApproved(item: any) {
		if (item.audit_status === 1 && item._id) {
			uni.navigateTo({ url: '/pages/Detail/detail?id=' + item._id });
		}
	}

	/* ========== 左滑操作：手势由 swipe-cell 组件处理，页面只负责按钮语义 ========== */
	const photoActions = [
		{ key: 'edit', label: '编辑', type: 'edit' },
		{ key: 'delete', label: '删除', type: 'delete' }
	];

	function onSwipeAction(key: string, item: any) {
		if (key === 'edit') openEdit(item);
		else if (key === 'delete') confirmDelete(item);
	}

	/* ========== 编辑描述 ========== */
	const editVisible = ref(false);
	const editText = ref('');
	let editingItem: any = null;

	function openEdit(item: any) {
		editingItem = item;
		editText.value = item.description || '';
		editVisible.value = true;
	}

	async function saveEdit() {
		if (!editingItem) return;
		uni.showLoading({ title: '保存中…', mask: true });
		try {
			const res = await uniCloud.callFunction({
				name: 'wallpaper-action',
				data: { action: 'updateUpload', id: editingItem._id, description: editText.value.trim().slice(0, 100) }
			});
			const r = res.result || {};
			if (r.errCode) {
				uni.showToast({ title: r.errMsg || '保存失败', icon: 'none' });
				return;
			}
			// 本地同步：描述更新、回到待审核、清掉驳回原因
			editingItem.description = editText.value.trim().slice(0, 100);
			editingItem.audit_status = 0;
			delete editingItem.audit_reason;
			editVisible.value = false;
			uni.showToast({ title: '已保存，待重新审核', icon: 'none' });
		} catch (e) {
			uni.showToast({ title: '保存失败，请重试', icon: 'none' });
		} finally {
			uni.hideLoading();
		}
	}

	/* ========== 删除上传 ========== */
	function confirmDelete(item: any) {
		uni.showModal({
			title: '删除这条上传？',
			content: hideComments.value
				? '删除后不可恢复，相关的点赞也会一并清除'
				: '删除后不可恢复，相关的点赞和评论也会一并清除',
			confirmText: '删除',
			confirmColor: '#e65a5a',
			success: async (m) => {
				if (!m.confirm) return;
				uni.showLoading({ title: '删除中…', mask: true });
				try {
					const res = await uniCloud.callFunction({
						name: 'wallpaper-action',
						data: { action: 'deleteUpload', id: item._id }
					});
					const r = res.result || {};
					if (r.errCode) {
						uni.showToast({ title: r.errMsg || '删除失败', icon: 'none' });
						return;
					}
					list.value = list.value.filter((i) => i._id !== item._id);
					uni.showToast({ title: '已删除', icon: 'success' });
				} catch (e) {
					uni.showToast({ title: '删除失败，请重试', icon: 'none' });
				} finally {
					uni.hideLoading();
				}
			}
		});
	}

</script>

<style lang="scss">
	.page {
		min-height: 100vh;
		background: #f5f7fa;
	}

	.list {
		padding: 24rpx;
	}

	.feed {
		position: relative;
	}

	/* 加载期撑住高度：骨架层绝对定位不占位，避免塌陷跳动 */
	.feed-loading {
		min-height: 1420rpx;
	}

	/* 骨架文字行（灰块底与斜向扫光由全局 .sk / .sk-shine 提供） */
	.sk-line {
		height: 26rpx;
		width: 90%;
		margin-top: 16rpx;

		&.short {
			width: 55%;
		}
	}

	/* 左滑骨架行：真实卡片的左滑交互见 components/swipe-cell */
	.swipe-item {
		position: relative;
		margin-bottom: 20rpx;
		border-radius: 20rpx;
		overflow: hidden;
	}

	.card {
		display: flex;
		background: #fff;
		border-radius: 20rpx;
		padding: 20rpx;
		box-shadow: 0 4rpx 16rpx rgba(56, 151, 228, 0.05);

		// 驳回卡片：淡红底色 + 左侧红色竖条，整体一眼可辨
		&.card-rejected {
			background: #fff7f7;
			border: 1rpx solid #fbdcdc;
			box-shadow: none;
			position: relative;
			overflow: hidden;

			&::before {
				content: '';
				position: absolute;
				left: 0;
				top: 0;
				bottom: 0;
				width: 6rpx;
				background: #e65a5a;
			}
		}

		.thumb {
			position: relative;
			width: 188rpx; // 15:16
			height: 200rpx;
			border-radius: 12rpx;
			overflow: hidden;
			background: #eef4fa;
			flex-shrink: 0;

			image {
				width: 100%;
				height: 100%;
			}

			.badge {
				position: absolute;
				top: 0;
				left: 0;
				padding: 4rpx 14rpx;
				font-size: 20rpx;
				color: #fff;
				border-bottom-right-radius: 12rpx;

				&-0 {
					background: rgba(240, 161, 52, 0.92);
				}

				&-1 {
					background: rgba(46, 184, 110, 0.92);
				}

				&-2 {
					background: rgba(230, 90, 90, 0.92);
				}
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

			// 驳回原因：独立提示条
			.reject {
				display: flex;
				align-items: center;
				align-self: flex-start;
				max-width: 100%;
				margin-top: 12rpx;
				padding: 8rpx 16rpx;
				background: #fdecec;
				border-radius: 8rpx;
				gap: 6rpx;
				box-sizing: border-box;

				.reject-text {
					font-size: 22rpx;
					color: #d04848;
					line-height: 1.4;
					display: -webkit-box;
					-webkit-box-orient: vertical;
					-webkit-line-clamp: 2;
					overflow: hidden;

					&::before {
						content: '驳回原因：';
						font-weight: bold;
					}
				}
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

	.fab {
		position: fixed;
		right: 40rpx;
		bottom: 60rpx;
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

	/* 编辑描述弹窗 */
	.edit-mask {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.edit-dialog {
		width: 600rpx;
		background: #fff;
		border-radius: 24rpx;
		padding: 36rpx 32rpx 28rpx;
		box-sizing: border-box;

		.edit-title {
			font-size: 32rpx;
			font-weight: bold;
			color: #333;
			text-align: center;
			margin-bottom: 24rpx;
		}

		.edit-textarea {
			width: 100%;
			min-height: 140rpx;
			background: #f5f7fa;
			border-radius: 12rpx;
			padding: 20rpx;
			font-size: 28rpx;
			color: #333;
			box-sizing: border-box;
		}

		.edit-tip {
			margin-top: 16rpx;
			font-size: 22rpx;
			color: #a7bfd3;
			line-height: 1.5;
		}

		.edit-btns {
			display: flex;
			gap: 20rpx;
			margin-top: 28rpx;

			.edit-btn {
				flex: 1;
				height: 76rpx;
				line-height: 76rpx;
				text-align: center;
				border-radius: 38rpx;
				font-size: 28rpx;

				&.cancel {
					background: #f0f3f7;
					color: #6b7d8f;
				}

				&.confirm {
					background: linear-gradient(90deg, #4facfe 0%, #2c98e7 100%);
					color: #fff;
				}
			}
		}
	}
</style>
