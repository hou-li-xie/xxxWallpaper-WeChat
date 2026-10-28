<template>
	<view class="page">
		<!-- 数据概览 -->
		<scroll-view v-if="stats" scroll-x class="stats-bar" :show-scrollbar="false">
			<view class="stat"><text class="stat-num">{{ stats.pending }}</text><text class="stat-label">待审核</text></view>
			<view class="stat"><text class="stat-num">{{ stats.approved }}</text><text class="stat-label">已通过</text></view>
			<view class="stat"><text class="stat-num">{{ stats.rejected }}</text><text class="stat-label">已驳回</text></view>
			<view class="stat"><text class="stat-num">{{ stats.reportsPending }}</text><text class="stat-label">待处理举报</text></view>
			<view class="stat"><text class="stat-num">{{ stats.users }}</text><text class="stat-label">用户</text></view>
			<!-- wx:audit off 审核期屏蔽评论统计项
			<view v-if="!hideComments" class="stat"><text class="stat-num">{{ stats.comments }}</text><text class="stat-label">评论</text></view>
			
			<!-- /wx:audit -->
			<view class="stat"><text class="stat-num">{{ stats.likes }}</text><text class="stat-label">点赞</text></view>
		</scroll-view>

		<!-- 模式切换 -->
		<view class="modes">
			<view
				v-for="m in modes"
				:key="m.value"
				class="mode"
				:class="{ active: mode === m.value }"
				@click="switchMode(m.value)"
			>
				{{ m.label }}
			</view>
		</view>

		<!-- ================= 照片审核 ================= -->
		<template v-if="mode === 'photo'">
			<filter-tabs :tabs="tabs" :model-value="activeStatus" @change="switchTab" />

			<!-- 批量管理条（待审核 Tab 可用） -->
			<view v-if="activeStatus === 0" class="batch-bar">
				<view class="batch-toggle" @click="toggleBatch">{{ batchMode ? '退出批量' : '批量管理' }}</view>
				<template v-if="batchMode">
					<view class="batch-all" @click="toggleSelectAll">全选</view>
					<view class="batch-approve" :class="{ disabled: !selectedCount }" @click="batchApprove">
						批量通过({{ selectedCount }})
					</view>
				</template>
			</view>

			<view class="feed" :class="{ 'feed-loading': skVisible }">
				<view class="list">
					<!-- 空态：骨架移除后再展示，避免与骨架重叠 -->
					<empty-state
						v-if="!skVisible && !list.length"
						icon="checkbox-filled"
						:text="activeStatus === 0 ? '太棒了，没有待审核的照片' : '暂无数据'"
					/>

					<view
						class="card reveal-blk"
						v-for="(item, index) in list"
						:key="item._id"
						:class="{ 'card-rejected': item.audit_status === 2 }"
						:style="{ animationDelay: d(index, 0) }"
						@click="batchMode && toggleSelect(item)"
					>
						<view class="card-main">
							<view class="thumb reveal-blk" :style="{ animationDelay: d(index, 1) }" @click.stop="onThumbClick(item)">
								<image :src="item._imgUrl" mode="aspectFill"></image>
								<view v-if="batchMode" class="check" :class="{ checked: !!selectedMap[item._id] }">
									<uni-icons v-if="selectedMap[item._id]" type="checkmarkempty" size="14" color="#fff"></uni-icons>
								</view>
								<view v-else class="badge" :class="'badge-' + item.audit_status">
									{{ statusText[item.audit_status] || '待审核' }}
								</view>
							</view>
							<view class="meta">
								<view class="author-row reveal-blk" :style="{ animationDelay: d(index, 2) }">
									<image v-if="item._avatarUrl" class="author-avatar" :src="item._avatarUrl" mode="aspectFill"></image>
									<text class="author-name">{{ (item.author && item.author.name) || '用户' }}</text>
									<!-- wx:audit off 审核期屏蔽带评论数的分支，让 v-else 分支自然落下 
									<!-- /wx:audit -->
									<text class="stats">赞 {{ (item.info && item.info.likeNum) || 0 }}</text>
								</view>
								<view class="desc reveal-blk" :style="{ animationDelay: d(index, 3) }">{{ item.description || '（未填写描述）' }}</view>
								<view class="time reveal-blk" :style="{ animationDelay: d(index, 4) }">{{ formatTime(item.createTime) }}</view>
							</view>
						</view>

						<view v-if="item.audit_status === 2 && item.audit_reason" class="reject">
							<uni-icons type="info-filled" size="13" color="#e65a5a"></uni-icons>
							<text class="reject-text">{{ item.audit_reason }}</text>
						</view>

						<view v-if="!batchMode" class="ops">
							<view v-if="item.audit_status !== 1" class="op op-approve" @click.stop="approve(item)">通过</view>
							<view v-if="item.audit_status !== 2" class="op op-reject" @click.stop="openReject(item)">驳回</view>
							<view class="op op-edit" @click.stop="openEdit(item)">编辑</view>
							<view class="op op-delete" @click.stop="confirmDelete(item)">删除</view>
						</view>
					</view>

					<view v-if="list.length" class="loadmore">{{ loadmoreText }}</view>
				</view>

				<!-- 骨架屏：缩略图 + 头像行 + 两行文字 + 操作按钮，共用一道斜向光带 -->
				<view v-if="skVisible" class="sk-layer" :class="{ 'sk-out': skFading }">
					<view class="list">
						<view class="card" v-for="i in 4" :key="i">
							<view class="card-main">
								<view class="thumb sk"></view>
								<view class="meta">
									<view class="author-row">
										<view class="author-avatar sk"></view>
										<view class="sk sk-line sk-name"></view>
									</view>
									<view class="sk sk-line"></view>
									<view class="sk sk-line short"></view>
								</view>
							</view>
							<view class="ops">
								<view class="sk sk-op" v-for="k in 3" :key="k"></view>
							</view>
						</view>
					</view>
					<view class="sk-shine"></view>
				</view>
			</view>
		</template>

		<!-- ================= 举报处理 ================= -->
		<template v-else-if="mode === 'report'">
			<filter-tabs :tabs="reportTabs" :model-value="reportStatus" @change="switchReportTab" />

			<view class="feed" :class="{ 'feed-loading': skVisible }">
				<view class="list">
					<!-- 空态：骨架移除后再展示，避免与骨架重叠 -->
					<empty-state
						v-if="!skVisible && !reportList.length"
						icon="flag-filled"
						:text="reportStatus === 0 ? '没有待处理的举报' : '暂无数据'"
					/>

					<view class="card reveal-blk" v-for="(item, index) in reportList" :key="item._id" :style="{ animationDelay: d(index, 0) }">
						<view class="card-main">
							<view class="thumb reveal-blk" :style="{ animationDelay: d(index, 1) }" @click="preview(item._imgUrl)">
								<image v-if="item._imgUrl" :src="item._imgUrl" mode="aspectFill"></image>
								<view v-else class="thumb-deleted">已删除</view>
								<view class="badge" :class="'rbadge-' + item.status">{{ reportStatusText[item.status] }}</view>
							</view>
							<view class="meta">
								<view class="author-row reveal-blk" :style="{ animationDelay: d(index, 2) }">
									<text class="author-name">{{ item.reporter_name }}</text>
									<text class="stats">举报了 {{ (item.wallpaper && item.wallpaper.author && item.wallpaper.author.name) || '未知作者' }}</text>
								</view>
								<view class="desc report-reason reveal-blk" :style="{ animationDelay: d(index, 3) }">{{ item.reason }}</view>
								<view class="time reveal-blk" :style="{ animationDelay: d(index, 4) }">{{ formatTime(item.create_time) }}</view>
							</view>
						</view>

						<view v-if="item.status !== 0 && item.handle_note" class="reject handle-note">
							<uni-icons type="info-filled" size="13" color="#5a8fc2"></uni-icons>
							<text class="note-text">{{ item.handle_note }}</text>
						</view>

						<view v-if="item.status === 0" class="ops">
							<view v-if="item.wallpaper" class="op op-delete" @click="handleReport(item, 'delete')">删除照片</view>
							<view class="op op-ignore" @click="handleReport(item, 'ignore')">忽略</view>
						</view>
					</view>

					<view v-if="reportList.length" class="loadmore">{{ loadmoreText }}</view>
				</view>

				<!-- 骨架屏：缩略图 + 举报人行 + 两行文字 + 操作按钮，共用一道斜向光带 -->
				<view v-if="skVisible" class="sk-layer" :class="{ 'sk-out': skFading }">
					<view class="list">
						<view class="card" v-for="i in 4" :key="i">
							<view class="card-main">
								<view class="thumb sk"></view>
								<view class="meta">
									<view class="author-row">
										<view class="sk sk-line sk-name"></view>
									</view>
									<view class="sk sk-line"></view>
									<view class="sk sk-line short"></view>
								</view>
							</view>
							<view class="ops">
								<view class="sk sk-op" v-for="k in 2" :key="k"></view>
							</view>
						</view>
					</view>
					<view class="sk-shine"></view>
				</view>
			</view>
		</template>

		<!-- wx:audit off 审核期屏蔽评论管理整块（受 !hideComments 控制）
		<template v-else-if="mode === 'comment' && !hideComments">
			<view class="feed" :class="{ 'feed-loading': skVisible }">
				<view class="list">
					<empty-state v-if="!skVisible && !commentList.length" icon="chatbubble-filled" text="暂无评论" />

					<view class="card reveal-blk" v-for="(item, index) in commentList" :key="item._id" :style="{ animationDelay: d(index, 0) }">
						<view class="comment-head reveal-blk" :style="{ animationDelay: d(index, 1) }">
							<text class="comment-author">{{ (item.author && item.author.name) || '用户' }}</text>
							<text class="comment-kind">{{ item.parent_id ? '回复' : '评论' }}</text>
							<text class="time">{{ formatTime(item.create_time) }}</text>
						</view>
						<view class="comment-content reveal-blk" :style="{ animationDelay: d(index, 2) }">{{ item.content }}</view>
						<view class="comment-foot reveal-blk" :style="{ animationDelay: d(index, 3) }">
							<image v-if="item._wallpaperUrl" class="comment-thumb" :src="item._wallpaperUrl" mode="aspectFill"></image>
							<view class="op op-delete comment-del" @click="confirmDeleteComment(item)">删除</view>
						</view>
					</view>

					<view v-if="commentList.length" class="loadmore">{{ loadmoreText }}</view>
				</view>

				<view v-if="skVisible" class="sk-layer" :class="{ 'sk-out': skFading }">
					<view class="list">
						<view class="card" v-for="i in 6" :key="i">
							<view class="sk sk-line head"></view>
							<view class="sk sk-line"></view>
							<view class="sk sk-line short"></view>
							<view class="comment-foot">
								<view class="comment-thumb sk"></view>
								<view class="sk sk-op"></view>
							</view>
						</view>
					</view>
					<view class="sk-shine"></view>
				</view>
			</view>
		</template>
		
		<!-- /wx:audit -->

		<!-- ================= 用户管理 ================= -->
		<template v-else-if="mode === 'user'">
			<view class="search-bar">
				<input
					class="search-input"
					v-model="userKeyword"
					placeholder="搜索用户昵称"
					confirm-type="search"
					@confirm="reloadUsers"
				/>
				<view class="search-btn" @click="reloadUsers">搜索</view>
			</view>

			<view class="feed" :class="{ 'feed-loading': skVisible }">
				<view class="list">
					<!-- 空态：骨架移除后再展示，避免与骨架重叠 -->
					<empty-state v-if="!skVisible && !userList.length" icon="person-filled" text="没有找到用户" />

					<view class="card user-card reveal-blk" v-for="(item, index) in userList" :key="item._id" :style="{ animationDelay: d(index, 0) }">
						<image v-if="item._avatarUrl" class="user-avatar reveal-blk" :style="{ animationDelay: d(index, 1) }" :src="item._avatarUrl" mode="aspectFill"></image>
						<view v-else class="user-avatar user-avatar-default reveal-blk" :style="{ animationDelay: d(index, 1) }">
							<uni-icons type="person-filled" size="20" color="#c2ccd8"></uni-icons>
						</view>
						<view class="user-meta">
							<view class="user-name-row reveal-blk" :style="{ animationDelay: d(index, 2) }">
								<text class="user-name">{{ item.nickname || '用户' }}</text>
								<text v-if="item.is_admin === 1" class="user-tag tag-admin">管理员</text>
								<text v-if="item.status === 1" class="user-tag tag-banned">已封禁</text>
							</view>
							<text class="user-time reveal-blk" :style="{ animationDelay: d(index, 3) }">注册于 {{ formatTime(item.register_date) }}</text>
						</view>
						<view
							v-if="item.is_admin !== 1"
							class="op reveal-blk"
							:class="item.status === 1 ? 'op-unban' : 'op-ban'"
							:style="{ animationDelay: d(index, 4) }"
							@click="toggleUserStatus(item)"
						>
							{{ item.status === 1 ? '解封' : '封禁' }}
						</view>
					</view>

					<view v-if="userList.length" class="loadmore">{{ loadmoreText }}</view>
				</view>

				<!-- 骨架屏：头像 + 昵称行 + 注册时间 + 操作按钮，共用一道斜向光带 -->
				<view v-if="skVisible" class="sk-layer" :class="{ 'sk-out': skFading }">
					<view class="list">
						<view class="card user-card" v-for="i in 6" :key="i">
							<view class="user-avatar sk"></view>
							<view class="user-meta">
								<view class="sk sk-line sk-name"></view>
								<view class="sk sk-line short"></view>
							</view>
							<view class="sk sk-op"></view>
						</view>
					</view>
					<view class="sk-shine"></view>
				</view>
			</view>
		</template>

		<!-- 驳回弹窗 -->
		<view v-if="rejectVisible" class="dialog-mask" @click="rejectVisible = false">
			<view class="dialog" @click.stop>
				<view class="dialog-title">驳回原因</view>
				<textarea
					v-model="rejectText"
					class="dialog-textarea"
					maxlength="100"
					placeholder="必填，将展示给作者"
					auto-height
				/>
				<view class="dialog-btns">
					<view class="dialog-btn cancel" @click="rejectVisible = false">取消</view>
					<view class="dialog-btn danger" @click="confirmReject">确认驳回</view>
				</view>
			</view>
		</view>

		<!-- 编辑描述弹窗 -->
		<view v-if="editVisible" class="dialog-mask" @click="editVisible = false">
			<view class="dialog" @click.stop>
				<view class="dialog-title">编辑描述</view>
				<textarea
					v-model="editText"
					class="dialog-textarea"
					maxlength="200"
					placeholder="描述一下这张照片…"
					auto-height
				/>
				<view class="dialog-tip">管理员修改不影响当前审核状态</view>
				<view class="dialog-btns">
					<view class="dialog-btn cancel" @click="editVisible = false">取消</view>
					<view class="dialog-btn confirm" @click="saveEdit">保存</view>
				</view>
			</view>
		</view>
	</view>
</template>

<script setup lang="ts">
	import { ref, computed } from 'vue';
	import { onShow, onReachBottom } from '@dcloudio/uni-app';
	import { isLoggedIn } from '../../utils/auth';
	import { resolveFileUrls } from '../../utils/cloud-file';
	import { formatDateTime as formatTime } from '../../utils/format-time';
	import { useSkeleton } from '../../utils/skeleton';
	import { storeToRefs } from 'pinia';
	import { useAppConfigStore } from '../../store/app-config';

	// wx:audit off 审核期注释：hideComments 变量无引用
	// 全局开关：true 时隐藏评论相关内容
	// const appStore = useAppConfigStore();
	// const { hideContent: hideComments } = storeToRefs(appStore);
	// /wx:audit

	const modes = computed(() => {
		const arr = [
			{ label: '照片', value: 'photo' },
			{ label: '举报', value: 'report' }
		];
		// wx:audit off 审核期屏蔽：不加入评论 tab
		// if (!hideComments.value) arr.push({ label: '评论', value: 'comment' });
		// /wx:audit
		arr.push({ label: '用户', value: 'user' });
		return arr;
	});
	const tabs = [
		{ label: '待审核', value: 0 },
		{ label: '已通过', value: 1 },
		{ label: '已驳回', value: 2 },
		{ label: '全部', value: -1 }
	];
	const reportTabs = [
		{ label: '待处理', value: 0 },
		{ label: '已处理', value: 1 },
		{ label: '已忽略', value: 2 }
	];
	const statusText = { 0: '待审核', 1: '已通过', 2: '已驳回' };
	const reportStatusText = { 0: '待处理', 1: '已处理', 2: '已忽略' };

	const mode = ref('photo');
	const stats = ref<Record<string, any> | null>(null);
	const loading = ref(false);
	const hasMore = ref(false);

	const activeStatus = ref(0);
	const list = ref<any[]>([]);

	const reportStatus = ref(0);
	const reportList = ref<any[]>([]);
	const commentList = ref<any[]>([]);
	const userList = ref<any[]>([]);
	const userKeyword = ref('');

	// 批量审核状态
	const batchMode = ref(false);
	const selectedMap = ref<Record<string, boolean>>({});
	const selectedCount = computed(() => Object.keys(selectedMap.value).length);

	const loadmoreText = computed(() => {
		if (loading.value) return '加载中…';
		return hasMore.value ? '上拉加载更多' : '没有更多了';
	});

	// 骨架屏：首屏/切换模式加载中显示，数据到达后淡出
	const { skVisible, skFading, skDone, skRestart } = useSkeleton();

	// 内容块依次浮现的延迟：卡片按序号错开（前 5 张封顶），卡片内各块再按 60ms 递增
	function d(index: number, step: number): string {
		return Math.min(index, 5) * 60 + step * 60 + 'ms';
	}

	onShow(() => {
		if (!isLoggedIn()) {
			uni.redirectTo({
				url: '/pages/Login/login?redirect=' + encodeURIComponent('/pages/Admin/admin')
			});
			return;
		}
		loadStats();
		reloadCurrent();
	});

	onReachBottom(() => {
		if (!hasMore.value || loading.value) return;
		loadCurrent();
	});

	function switchMode(value: string) {
		if (mode.value === value) return;
		mode.value = value;
		hasMore.value = false;
		skRestart(); // 切换模式重新走一次骨架 → 内容浮现
		reloadCurrent();
	}

	function reloadCurrent() {
		if (mode.value === 'photo') reload();
		else if (mode.value === 'report') reloadReports();
		else if (mode.value === 'comment') reloadComments();
		else reloadUsers();
	}

	function loadCurrent() {
		if (mode.value === 'photo') loadList();
		else if (mode.value === 'report') loadReports();
		else if (mode.value === 'comment') loadComments();
		else loadUsers();
	}

	/* ========== 数据概览 ========== */
	async function loadStats() {
		try {
			const res = await uniCloud.callFunction({
				name: 'wallpaper-action',
				data: { action: 'adminStats' }
			});
			const r = res.result || {};
			if (!r.errCode) stats.value = r.stats;
		} catch (e) {}
	}

	/* ========== 通用调用 ========== */
	async function callAction(data: Record<string, any>) {
		uni.showLoading({ title: '处理中…', mask: true });
		try {
			const res = await uniCloud.callFunction({ name: 'wallpaper-action', data });
			const r = res.result || {};
			if (r.errCode) {
				uni.showToast({ title: r.errMsg || '操作失败', icon: 'none' });
				return null;
			}
			return r;
		} catch (e) {
			uni.showToast({ title: '操作失败，请重试', icon: 'none' });
			return null;
		} finally {
			uni.hideLoading();
		}
	}

	// 通用列表加载：调 action + 换临时链接 + 追加
	async function fetchList(action: string, extraData: Record<string, any>, targetList: any, mapItem: (it: any, urlMap: Record<string, string>) => any) {
		loading.value = true;
		try {
			const res = await uniCloud.callFunction({
				name: 'wallpaper-action',
				data: { action, skip: targetList.value.length, ...extraData }
			});
			const r = res.result || {};
			if (r.errCode) {
				if (r.errCode === 'NO_PERMISSION' || r.errCode === 'LOGIN_REQUIRED') {
					uni.showToast({ title: '无管理员权限', icon: 'none' });
					setTimeout(() => uni.navigateBack(), 800);
					return;
				}
				uni.showToast({ title: r.errMsg || '加载失败', icon: 'none' });
				return;
			}
			const records: any[] = r.list || [];
			const fileIds: string[] = [];
			records.forEach((it) => collectFileIds(it, fileIds));
			const urlMap = await resolveFileUrls(fileIds);
			const mapped = records.map((it) => mapItem(it, urlMap));
			targetList.value = targetList.value.concat(mapped);
			hasMore.value = !!r.hasMore;
		} catch (e) {
			console.error('后台列表加载失败', e);
			uni.showToast({ title: '加载失败，请重试', icon: 'none' });
		} finally {
			loading.value = false;
			skDone(); // 无论成功失败都让骨架淡出，避免卡在加载态
		}
	}

	function collectFileIds(it: any, out: string[]) {
		if (mode.value === 'photo') {
			if (it.image) out.push(it.image);
			if (it.author && it.author.avatar) out.push(it.author.avatar);
		} else if (mode.value === 'report') {
			if (it.wallpaper && it.wallpaper.image) out.push(it.wallpaper.image);
		} else if (mode.value === 'comment') {
			if (it._wallpaperImage) out.push(it._wallpaperImage);
		} else if (mode.value === 'user') {
			if (it.avatar) out.push(it.avatar);
		}
	}

	/* ================= 照片审核 ================= */
	function switchTab(value: number) {
		if (activeStatus.value === value) return;
		activeStatus.value = value;
		batchMode.value = false;
		selectedMap.value = {};
		skRestart(); // 切换审核状态重新走一次骨架
		reload();
	}

	function reload() {
		list.value = [];
		hasMore.value = false;
		batchMode.value = false;
		selectedMap.value = {};
		loadList();
	}

	function loadList() {
		fetchList('adminList', { status: activeStatus.value }, list, (it, urlMap) => ({
			...it,
			audit_status: it.audit_status ?? 0,
			_imgUrl: urlMap[it.image] || '',
			_avatarUrl: (it.author && urlMap[it.author.avatar]) || ''
		}));
	}

	function preview(url: string) {
		if (!url) return;
		uni.previewImage({ urls: [url], current: url });
	}

	function onThumbClick(item: any) {
		if (batchMode.value) return toggleSelect(item);
		preview(item._imgUrl);
	}

	// 状态变更后的本地同步：「全部」页原地更新，其余页从列表移除（与服务端筛选结果保持一致）
	function afterStatusChange(item: any, status: number, reasonText?: string) {
		if (activeStatus.value === -1) {
			item.audit_status = status;
			if (status === 2) item.audit_reason = reasonText;
			else delete item.audit_reason;
		} else {
			list.value = list.value.filter((i) => i._id !== item._id);
		}
	}

	async function approve(item: any) {
		const r = await callAction({ action: 'auditApprove', id: item._id });
		if (!r) return;
		afterStatusChange(item, 1);
		loadStats();
		uni.showToast({ title: '已通过', icon: 'success' });
	}

	/* ========== 批量审核 ========== */
	function toggleBatch() {
		batchMode.value = !batchMode.value;
		if (!batchMode.value) selectedMap.value = {};
	}

	function toggleSelect(item: any) {
		const m = { ...selectedMap.value };
		if (m[item._id]) delete m[item._id];
		else m[item._id] = true;
		selectedMap.value = m;
	}

	function toggleSelectAll() {
		if (selectedCount.value === list.value.length) {
			selectedMap.value = {};
		} else {
			const m = {};
			list.value.forEach((i) => { m[i._id] = true; });
			selectedMap.value = m;
		}
	}

	function batchApprove() {
		const ids = Object.keys(selectedMap.value);
		if (!ids.length) return;
		uni.showModal({
			title: '批量通过',
			content: `将通过选中的 ${ids.length} 张照片，确认吗？`,
			success: async (m) => {
				if (!m.confirm) return;
				const r = await callAction({ action: 'batchApprove', ids });
				if (!r) return;
				const idSet = new Set(ids);
				list.value = list.value.filter((i) => !idSet.has(i._id));
				selectedMap.value = {};
				loadStats();
				uni.showToast({ title: `已通过 ${r.approved || ids.length} 张`, icon: 'success' });
			}
		});
	}

	/* ========== 审核驳回 ========== */
	const rejectVisible = ref(false);
	const rejectText = ref('');
	let rejectingItem: any = null;

	function openReject(item: any) {
		rejectingItem = item;
		rejectText.value = '';
		rejectVisible.value = true;
	}

	async function confirmReject() {
		if (!rejectingItem) return;
		const text = rejectText.value.trim();
		if (!text) {
			uni.showToast({ title: '请填写驳回原因', icon: 'none' });
			return;
		}
		const r = await callAction({ action: 'auditReject', id: rejectingItem._id, reason: text });
		if (!r) return;
		rejectVisible.value = false;
		afterStatusChange(rejectingItem, 2, text);
		loadStats();
		uni.showToast({ title: '已驳回', icon: 'none' });
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
		const r = await callAction({
			action: 'adminUpdate',
			id: editingItem._id,
			description: editText.value.trim()
		});
		if (!r) return;
		editingItem.description = editText.value.trim();
		editVisible.value = false;
		uni.showToast({ title: '已保存', icon: 'success' });
	}

	/* ========== 删除照片 ========== */
	function confirmDelete(item: any) {
		uni.showModal({
			title: '删除这条照片？',
			content: '删除后不可恢复，相关的点赞、评论和通知也会一并清除',
			confirmText: '删除',
			confirmColor: '#e65a5a',
			success: async (m) => {
				if (!m.confirm) return;
				const r = await callAction({ action: 'adminDelete', id: item._id });
				if (!r) return;
				list.value = list.value.filter((i) => i._id !== item._id);
				loadStats();
				uni.showToast({ title: '已删除', icon: 'success' });
			}
		});
	}

	/* ================= 举报处理 ================= */
	function switchReportTab(value: number) {
		if (reportStatus.value === value) return;
		reportStatus.value = value;
		skRestart(); // 切换举报状态重新走一次骨架
		reloadReports();
	}

	function reloadReports() {
		reportList.value = [];
		hasMore.value = false;
		loadReports();
	}

	function loadReports() {
		fetchList('adminReports', { status: reportStatus.value }, reportList, (it, urlMap) => ({
			...it,
			_imgUrl: (it.wallpaper && urlMap[it.wallpaper.image]) || ''
		}));
	}

	function handleReport(item: any, result: string) {
		const isDelete = result === 'delete';
		uni.showModal({
			title: isDelete ? '删除被举报照片？' : '忽略这条举报？',
			content: isDelete
				? '照片及其点赞/评论/通知将被删除，作者会收到违规通知，该照片的所有举报一并结案'
				: '举报将标记为已忽略，照片不受影响',
			confirmText: isDelete ? '删除' : '忽略',
			confirmColor: isDelete ? '#e65a5a' : '#2c98e7',
			success: async (m) => {
				if (!m.confirm) return;
				const r = await callAction({ action: 'handleReport', id: item._id, handleResult: result });
				if (!r) return;
				if (reportStatus.value === 0) {
					// 待处理队列：删除结案会同照片其他举报，一并移除
					reportList.value = isDelete
						? reportList.value.filter((i) => i.wallpaper_id !== item.wallpaper_id)
						: reportList.value.filter((i) => i._id !== item._id);
				} else {
					item.status = isDelete ? 1 : 2;
					item.handle_note = isDelete ? '违规，已删除照片' : '举报不成立，已忽略';
				}
				loadStats();
				uni.showToast({ title: isDelete ? '已删除并结案' : '已忽略', icon: 'success' });
			}
		});
	}

	/* ================= 评论管理 ================= */
	function reloadComments() {
		commentList.value = [];
		hasMore.value = false;
		loadComments();
	}

	function loadComments() {
		fetchList('adminComments', {}, commentList, (it, urlMap) => ({
			...it,
			_wallpaperUrl: urlMap[it._wallpaperImage] || ''
		}));
	}

	function confirmDeleteComment(item: any) {
		uni.showModal({
			title: '删除这条评论？',
			content: item.parent_id ? '删除后不可恢复' : '顶级评论的全部回复也会一并删除',
			confirmText: '删除',
			confirmColor: '#e65a5a',
			success: async (m) => {
				if (!m.confirm) return;
				const r = await callAction({ action: 'adminDeleteComment', commentId: item._id });
				if (!r) return;
				commentList.value = commentList.value.filter((i) => i._id !== item._id);
				loadStats();
				uni.showToast({ title: '已删除', icon: 'success' });
			}
		});
	}

	/* ================= 用户管理 ================= */
	function reloadUsers() {
		userList.value = [];
		hasMore.value = false;
		skRestart(); // 搜索重新走一次骨架
		loadUsers();
	}

	function loadUsers() {
		fetchList('adminUsers', { keyword: userKeyword.value.trim() }, userList, (it, urlMap) => ({
			...it,
			_avatarUrl: urlMap[it.avatar] || ''
		}));
	}

	function toggleUserStatus(item: any) {
		const toBan = item.status !== 1;
		uni.showModal({
			title: toBan ? '封禁该用户？' : '解封该用户？',
			content: toBan
				? `「${item.nickname || '用户'}」被封禁后将无法发布、评论、点赞和举报`
				: `「${item.nickname || '用户'}」解封后恢复正常使用`,
			confirmText: toBan ? '封禁' : '解封',
			confirmColor: toBan ? '#e65a5a' : '#2c98e7',
			success: async (m) => {
				if (!m.confirm) return;
				const r = await callAction({
					action: 'setUserStatus',
					targetUid: item._id,
					status: toBan ? 1 : 0
				});
				if (!r) return;
				item.status = toBan ? 1 : 0;
				uni.showToast({ title: toBan ? '已封禁' : '已解封', icon: 'success' });
			}
		});
	}

</script>

<style lang="scss">
	.page {
		min-height: 100vh;
		background: #f5f7fa;
	}

	/* 数据概览条 */
	.stats-bar {
		white-space: nowrap;
		background: #fff;
		padding: 20rpx 16rpx;
		box-shadow: 0 2rpx 12rpx rgba(56, 151, 228, 0.06);

		.stat {
			display: inline-flex;
			flex-direction: column;
			align-items: center;
			min-width: 130rpx;
			padding: 8rpx 10rpx;

			.stat-num {
				font-size: 34rpx;
				font-weight: bold;
				color: #2c98e7;
			}

			.stat-label {
				margin-top: 4rpx;
				font-size: 22rpx;
				color: #8a97a6;
			}
		}
	}

	/* 模式切换 */
	.modes {
		display: flex;
		background: #fff;
		padding: 0 10rpx;
		border-bottom: 1rpx solid #f0f3f7;

		.mode {
			flex: 1;
			text-align: center;
			padding: 22rpx 0;
			font-size: 28rpx;
			font-weight: bold;
			color: #6b7d8f;

			&.active {
				color: #2c98e7;
			}
		}
	}

	/* 批量管理条 */
	.batch-bar {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 16rpx;
		padding: 16rpx 24rpx 0;

		.batch-toggle,
		.batch-all {
			padding: 8rpx 24rpx;
			border-radius: 28rpx;
			font-size: 24rpx;
			color: #2c98e7;
			background: #e8f3fe;
		}

		.batch-approve {
			padding: 8rpx 24rpx;
			border-radius: 28rpx;
			font-size: 24rpx;
			color: #fff;
			background: #2eb86e;

			&.disabled {
				opacity: 0.4;
			}
		}
	}

	.list {
		padding: 24rpx;
	}

	.feed {
		position: relative;
	}

	/* 加载期撑住高度：骨架层绝对定位不占位，避免切换模式时页面塌陷 */
	.feed-loading {
		min-height: 1400rpx;
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

		/* 卡片首行（作者/举报人/评论作者行）：不带上间距 */
		&.head {
			width: 60%;
			margin-top: 0;
		}
	}

	/* 骨架中的人名条：与真实 .author-name / .user-name 对齐 */
	.sk-name {
		margin-top: 0;
		margin-left: 10rpx;
		height: 24rpx;
		width: 200rpx;
	}

	/* 骨架操作按钮：尺寸对齐 .op */
	.sk-op {
		flex-shrink: 0;
		width: 120rpx;
		height: 56rpx;
		border-radius: 28rpx;
	}

	.card {
		background: #fff;
		border-radius: 20rpx;
		padding: 20rpx;
		margin-bottom: 20rpx;
		box-shadow: 0 4rpx 16rpx rgba(56, 151, 228, 0.05);

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
	}

	.card-main {
		display: flex;
	}

	.thumb {
		position: relative;
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

		.thumb-deleted {
			width: 100%;
			height: 100%;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 22rpx;
			color: #a7bfd3;
		}

		.check {
			position: absolute;
			top: 10rpx;
			right: 10rpx;
			width: 40rpx;
			height: 40rpx;
			border-radius: 50%;
			background: rgba(255, 255, 255, 0.85);
			border: 2rpx solid #c2ccd8;
			display: flex;
			align-items: center;
			justify-content: center;

			&.checked {
				background: #2c98e7;
				border-color: #2c98e7;
			}
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

		.rbadge-0 {
			position: absolute;
			top: 0;
			left: 0;
			padding: 4rpx 14rpx;
			font-size: 20rpx;
			color: #fff;
			border-bottom-right-radius: 12rpx;
			background: rgba(240, 161, 52, 0.92);
		}

		.rbadge-1 {
			position: absolute;
			top: 0;
			left: 0;
			padding: 4rpx 14rpx;
			font-size: 20rpx;
			color: #fff;
			border-bottom-right-radius: 12rpx;
			background: rgba(46, 184, 110, 0.92);
		}

		.rbadge-2 {
			position: absolute;
			top: 0;
			left: 0;
			padding: 4rpx 14rpx;
			font-size: 20rpx;
			color: #fff;
			border-bottom-right-radius: 12rpx;
			background: rgba(140, 150, 160, 0.92);
		}
	}

	.meta {
		flex: 1;
		margin-left: 22rpx;
		display: flex;
		flex-direction: column;
		min-width: 0;

		.author-row {
			display: flex;
			align-items: center;

			.author-avatar {
				width: 40rpx;
				height: 40rpx;
				border-radius: 50%;
				background: #f2f8fe;
				flex-shrink: 0;
			}

			.author-name {
				margin-left: 10rpx;
				font-size: 26rpx;
				font-weight: bold;
				color: #333;
				max-width: 240rpx;
				overflow: hidden;
				white-space: nowrap;
				text-overflow: ellipsis;
			}

			.stats {
				margin-left: auto;
				font-size: 22rpx;
				color: #a7bfd3;
			}
		}

		.desc {
			margin-top: 10rpx;
			font-size: 28rpx;
			color: #333;
			line-height: 1.5;
			display: -webkit-box;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 2;
			overflow: hidden;

			&.report-reason {
				color: #d04848;
			}
		}

		.time {
			margin-top: 8rpx;
			font-size: 22rpx;
			color: #a7bfd3;
		}
	}

	.reject {
		display: flex;
		align-items: center;
		align-self: flex-start;
		max-width: 100%;
		margin-top: 14rpx;
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

		&.handle-note {
			background: #eef4fb;

			.note-text {
				font-size: 22rpx;
				color: #3a73ad;
				line-height: 1.4;

				&::before {
					content: '处理备注：';
					font-weight: bold;
				}
			}
		}
	}

	/* 操作按钮行 */
	.ops {
		display: flex;
		justify-content: flex-end;
		gap: 16rpx;
		margin-top: 16rpx;
		padding-top: 16rpx;
		border-top: 1rpx solid #f0f3f7;

		.op {
			padding: 10rpx 30rpx;
			border-radius: 30rpx;
			font-size: 24rpx;
			color: #fff;

			&.op-approve {
				background: #2eb86e;
			}

			&.op-reject {
				background: #f0a134;
			}

			&.op-edit {
				background: #4facfe;
			}

			&.op-delete {
				background: #e65a5a;
			}

			&.op-ignore {
				background: #8a97a6;
			}
		}
	}

	/* 评论管理卡片 */
	.comment-head {
		display: flex;
		align-items: center;

		.comment-author {
			font-size: 26rpx;
			font-weight: bold;
			color: #333;
		}

		.comment-kind {
			margin-left: 12rpx;
			padding: 2rpx 12rpx;
			border-radius: 8rpx;
			font-size: 20rpx;
			color: #2c98e7;
			background: #e8f3fe;
		}

		.time {
			margin-left: auto;
			font-size: 22rpx;
			color: #a7bfd3;
		}
	}

	.comment-content {
		margin-top: 12rpx;
		font-size: 28rpx;
		color: #333;
		line-height: 1.5;
		word-break: break-all;
	}

	.comment-foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 14rpx;
		padding-top: 14rpx;
		border-top: 1rpx solid #f0f3f7;

		.comment-thumb {
			width: 64rpx;
			height: 68rpx;
			border-radius: 8rpx;
			background: #eef4fa;
		}

		.comment-del {
			padding: 8rpx 28rpx;
			border-radius: 28rpx;
			font-size: 24rpx;
			color: #fff;
			background: #e65a5a;
		}
	}

	/* 用户管理 */
	.search-bar {
		display: flex;
		align-items: center;
		padding: 20rpx 24rpx 0;
		gap: 16rpx;

		.search-input {
			flex: 1;
			height: 68rpx;
			padding: 0 24rpx;
			background: #fff;
			border-radius: 34rpx;
			font-size: 26rpx;
		}

		.search-btn {
			padding: 0 32rpx;
			height: 68rpx;
			line-height: 68rpx;
			border-radius: 34rpx;
			background: linear-gradient(90deg, #4facfe 0%, #2c98e7 100%);
			color: #fff;
			font-size: 26rpx;
		}
	}

	.user-card {
		display: flex;
		align-items: center;

		.user-avatar {
			width: 80rpx;
			height: 80rpx;
			border-radius: 50%;
			background: #eef2f7;
			flex-shrink: 0;
		}

		.user-avatar-default {
			display: flex;
			align-items: center;
			justify-content: center;
		}

		.user-meta {
			flex: 1;
			margin-left: 18rpx;
			min-width: 0;
			display: flex;
			flex-direction: column;

			.user-name-row {
				display: flex;
				align-items: center;

				.user-name {
					font-size: 28rpx;
					font-weight: bold;
					color: #333;
					max-width: 300rpx;
					overflow: hidden;
					white-space: nowrap;
					text-overflow: ellipsis;
				}

				.user-tag {
					margin-left: 10rpx;
					padding: 2rpx 12rpx;
					border-radius: 8rpx;
					font-size: 20rpx;

					&.tag-admin {
						color: #2c98e7;
						background: #e8f3fe;
					}

					&.tag-banned {
						color: #e65a5a;
						background: #fdecec;
					}
				}
			}

			.user-time {
				margin-top: 6rpx;
				font-size: 22rpx;
				color: #a7bfd3;
			}
		}

		.op {
			flex-shrink: 0;
			padding: 10rpx 30rpx;
			border-radius: 30rpx;
			font-size: 24rpx;
			color: #fff;

			&.op-ban {
				background: #e65a5a;
			}

			&.op-unban {
				background: #2eb86e;
			}
		}
	}

	.loadmore {
		text-align: center;
		font-size: 24rpx;
		color: #a7bfd3;
		padding: 20rpx 0 40rpx;
	}

	/* 弹窗 */
	.dialog-mask {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.dialog {
		width: 600rpx;
		background: #fff;
		border-radius: 24rpx;
		padding: 36rpx 32rpx 28rpx;
		box-sizing: border-box;

		.dialog-title {
			font-size: 32rpx;
			font-weight: bold;
			color: #333;
			text-align: center;
			margin-bottom: 24rpx;
		}

		.dialog-textarea {
			width: 100%;
			min-height: 140rpx;
			background: #f5f7fa;
			border-radius: 12rpx;
			padding: 20rpx;
			font-size: 28rpx;
			color: #333;
			box-sizing: border-box;
		}

		.dialog-tip {
			margin-top: 16rpx;
			font-size: 22rpx;
			color: #a7bfd3;
			line-height: 1.5;
		}

		.dialog-btns {
			display: flex;
			gap: 20rpx;
			margin-top: 28rpx;

			.dialog-btn {
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

				&.danger {
					background: #e65a5a;
					color: #fff;
				}
			}
		}
	}
</style>