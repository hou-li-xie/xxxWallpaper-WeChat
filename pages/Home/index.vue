<template>
	<view class="content">
		<!-- ===== 固定头部：日期 + 搜索 + 标签（不随图片列表滚动）===== -->
		<!-- 顶部首行与微信胶囊同高，右侧预留胶囊宽度，避免「排行榜/标题」被胶囊遮挡 -->
		<view class="header" :style="headerStyle">
			<view class="header-row" :style="headerRowStyle">
				<text class="title">十月初汉妆集ヾ(*´・ω・`*)</text>
			</view>
			<view class="datelogo">
				<view class="date">
					<view class="dateDay">
						<text>{{ today.day }}</text>
					</view>
					<view class="dateYear">
						<text class="year">{{ today.yearMonth }}</text>
						<text class="week">{{ today.week }}</text>
					</view>
				</view>
				<view class="logo">
					<image src="/static/logo.jpeg" mode="aspectFit"></image>
				</view>
			</view>
			<!-- 搜索行：搜索框 + 排行榜入口（搜索时切换为「取消」） -->
			<view class="search-row">
				<view class="search-box">
					<uni-icons type="search" size="16" color="#7fa9c9"></uni-icons>
					<input
						class="search-input"
						v-model="searchInput"
						placeholder="搜索照片描述"
						placeholder-class="search-ph"
						maxlength="30"
						confirm-type="search"
						@confirm="doSearch"
					/>
				</view>
				<text v-if="searchMode" class="search-cancel" @click="cancelSearch">取消</text>
				<view v-else class="rank-entry" @click="goRank">
					<uni-icons type="trophy-filled" size="18" color="#1f5fae"></uni-icons>
					<text class="rank-text">排行榜</text>
				</view>
			</view>
		</view>

		<!-- 标签筛选（固定）+ 右侧筛选按钮 -->
		<view v-if="!searchMode" class="tag-row">
			<scroll-view scroll-x class="tag-bar" :show-scrollbar="false">
				<view
					v-for="t in tagList"
					:key="t"
					class="tag-chip"
					:class="{ active: activeTag === t }"
					@click="switchTag(t)"
				>
					{{ t }}
				</view>
			</scroll-view>
			<view class="filter-entry" :class="{ active: hasFilter }" @click="openFilter">
				<uni-icons type="funnel" size="16" :color="hasFilter ? '#fff' : '#2c98e7'"></uni-icons>
				<text class="filter-text">筛选</text>
			</view>
		</view>
		<view v-else class="search-tip">“{{ searchKeyword }}” 的搜索结果</view>

		<!-- 筛选面板：底部弹出，草稿态编辑，确定后才生效 -->
		<view v-if="filterVisible" class="filter-mask" @click="closeFilter">
			<view class="filter-panel" @click.stop>
				<view class="filter-head">
					<text class="filter-head-title">筛选与排序</text>
				</view>

				<view class="filter-sec-title">排序方式</view>
				<view class="opt-row">
					<view
						v-for="o in orderOptions"
						:key="o.value"
						class="opt"
						:class="{ on: fOrder === o.value }"
						@click="fOrder = o.value"
					>{{ o.label }}</view>
				</view>

				<view class="filter-sec-title">类型（可多选）</view>
				<view class="opt-row">
					<view
						v-for="t in filterTagOptions"
						:key="t"
						class="opt"
						:class="{ on: fTags.indexOf(t) !== -1 }"
						@click="toggleFilterTag(t)"
					>{{ t }}</view>
				</view>

				<view class="filter-sec-title">发布时间</view>
				<view class="opt-row">
					<view
						v-for="d in dateOptions"
						:key="d.value"
						class="opt"
						:class="{ on: fDate === d.value }"
						@click="fDate = d.value"
					>{{ d.label }}</view>
				</view>
				<!-- 自定义区间：选择「自定义」后展开两个日期选择器 -->
				<view v-if="fDate === 'custom'" class="custom-date-row">
					<picker mode="date" :value="fDateStart" :end="todayStr" @change="onDateStartChange">
						<view class="date-picker" :class="{ placeholder: !fDateStart }">
							<uni-icons type="calendar" size="14" :color="fDateStart ? '#2c98e7' : '#a7bfd3'"></uni-icons>
							<text style="margin-left: 8rpx;">{{ fDateStart || '开始日期' }}</text>
						</view>
					</picker>
					<text class="date-sep">至</text>
					<picker mode="date" :value="fDateEnd" :end="todayStr" @change="onDateEndChange">
						<view class="date-picker" :class="{ placeholder: !fDateEnd }">
							<uni-icons type="calendar" size="14" :color="fDateEnd ? '#2c98e7' : '#a7bfd3'"></uni-icons>
							<text style="margin-left: 8rpx;">{{ fDateEnd || '结束日期' }}</text>
						</view>
					</picker>
				</view>

				<view class="filter-sec-title">只看某个用户</view>
			<view class="author-search-box">
				<input
					class="filter-author-input"
					v-model="fAuthor"
					placeholder="输入作者昵称，留空为不限"
					placeholder-class="filter-author-ph"
					maxlength="20"
					@input="onAuthorInput"
				/>
				<!-- 昵称联想浮窗：绝对定位覆盖在输入框上方，不占据布局空间 -->
				<scroll-view v-if="authorCandidates.length" scroll-y class="author-popup">
					<view
						v-for="u in authorCandidates"
						:key="u._id"
						class="author-item"
						@click="pickAuthor(u)"
					>
						<image v-if="u._avatarUrl" class="author-avatar" :src="u._avatarUrl" mode="aspectFill"></image>
						<view v-else class="author-avatar author-avatar-default">
							<uni-icons type="person-filled" size="14" color="#c2ccd8"></uni-icons>
						</view>
						<text class="author-item-name">{{ u.nickname }}</text>
					</view>
				</scroll-view>
			</view>

				<view class="filter-btns">
					<view class="btn reset" @click="resetFilter">重置</view>
					<view class="btn ok" @click="applyFilter">确定</view>
				</view>
			</view>
		</view>

		<!-- ===== 滚动区：仅图片列表滚动，页面本身不滚动 ===== -->
		<scroll-view
			class="list-scroll"
			scroll-y
			:refresher-enabled="true"
			:refresher-triggered="refreshing"
			refresher-default-style="black"
			@refresherrefresh="onRefresh"
			@scrolltolower="onScrollToLower"
		>
			<view class="feed" :class="{ 'feed-loading': skVisible && !totalCount }">
			<!-- 空态：骨架移除后再展示，避免与骨架重叠 -->
			<view v-if="!skVisible && !totalCount" class="empty">
				<text class="empty-title">{{ emptyTitle }}</text>
				<text class="empty-sub">{{ emptySub }}</text>
			</view>

			<!-- 照片瀑布流：分流与列布局由 waterfall-list 组件处理 -->
			<waterfall-list class="wf" v-else-if="totalCount" :source="list" :meta-height="124" :gap="20">
				<template #default="{ item, index }">
					<!-- 数据到达后：图片 → 标题 → 作者/点赞行，从上到下每块错开 60ms 浮现 -->
					<view class="listBox" @click="goDetail(item._id)">
						<view class="photo reveal-blk" :style="{ height: item._h + 'rpx', animationDelay: d(index, 0) }">
							<image
								:src="item._imgUrl"
								mode="aspectFill"
								lazy-load
								:class="{ 'img-in': item._imgLoaded }"
								@load="onImgReady(item)"
								@error="onImgReady(item)"
							></image>
							<!-- 加载蒙版：同色模糊占位，图片未就绪时盖住渐进渲染，就绪后淡出 -->
							<view class="img-mask" :class="{ 'mask-out': item._imgLoaded }">
								<view class="sk-shine"></view>
							</view>
						</view>
						<view class="description reveal-blk" :style="{ animationDelay: d(index, 1) }">{{ item.description || '该用户什么也没留下....' }}</view>
						<view class="info reveal-blk" :style="{ animationDelay: d(index, 2) }">
							<view class="author" @click.stop="goUserHome(item)">
								<image class="author-avatar" :src="item._avatarUrl" mode="aspectFill"></image>
								<text class="author-name">{{ item.author ? item.author.name : '匿名' }}</text>
							</view>
							<view class="like">
							<view class="stat" :class="{ liked: item.liked }">
								<uni-icons :type="item.liked ? 'hand-up-filled' : 'hand-up'" size="13" :color="item.liked ? '#e65a5a' : '#9aa7b4'"></uni-icons>
								<text class="stat-num">{{ (item.info && item.info.likeNum) || 0 }}</text>
							</view>
							<!-- wx:audit off 审核期屏蔽（审核通过恢复）
							<view v-if="!hideComments" class="stat">
								<uni-icons type="chatbubble" size="13" color="#9aa7b4"></uni-icons>
								<text class="stat-num">{{ (item.info && item.info.commentNum) || 0 }}</text>
							</view>
							
							<!-- /wx:audit -->
						</view>
						</view>
					</view>
				</template>
			</waterfall-list>

			<view v-if="totalCount" class="loadmore">{{ loadmoreText }}</view>

			<!-- 骨架屏：双列错落，形状与真实卡片一致（照片 + 两行文字），共用一道斜向光带 -->
			<view v-if="skVisible && !totalCount" class="sk-layer" :class="{ 'sk-out': skFading }">
				<view class="wf">
					<view class="wf-col" v-for="(colHeightsArr, ci) in skeletonHeights" :key="ci">
						<view class="listBox" v-for="(h, hi) in colHeightsArr" :key="hi">
							<view class="sk sk-photo" :style="{ height: h + 'rpx' }"></view>
							<view class="sk sk-line"></view>
							<view class="sk sk-line short"></view>
						</view>
					</view>
				</view>
				<view class="sk-shine"></view>
			</view>
			</view>
		</scroll-view>

		<!-- wx:audit off 发布入口（审核期屏蔽） 
		<view v-if="!hideComments" class="fab" @click="goPublish">
			<uni-icons type="plusempty" size="30" color="#fff"></uni-icons>
		</view>
		-->
		<view class="fab" @click="goPublish">
			<uni-icons type="plusempty" size="30" color="#fff"></uni-icons>
		</view>
		<!-- /wx:audit -->
	</view>
</template>

<script setup lang="ts">
	import { ref, computed, onUnmounted } from "vue";
	import { onLoad, onShow, onShareAppMessage } from '@dcloudio/uni-app';
	import { resolveFileUrls } from '../../utils/cloud-file';
	import { useSkeleton } from '../../utils/skeleton';
	import { useMessageStore } from '../../store/message';
	import { storeToRefs } from 'pinia';
	import { useAppConfigStore } from '../../store/app-config';

	// wx:audit off 审核期注释：hideComments 变量无引用
	// const appStore = useAppConfigStore();
	// const { hideContent: hideComments } = storeToRefs(appStore);
	// /wx:audit

	// 未读角标：拉取未读数并同步消息 tab 角标
	const messageStore = useMessageStore();

	const PAGE_SIZE = 20;
	// 列表缓存有效期：onShow 时距上次加载不足 30s 则直接用缓存，避免每次切 tab 全量重刷
	const CACHE_TTL = 30 * 1000;

	// 瀑布流数据源（平铺数组，两列分流由 waterfall-list 组件处理）
	const list = ref<any[]>([]);
	const loading = ref(false);
	const hasMore = ref(false);
	const lastLoadAt = ref(0);
	// 请求序号：reload 时递增，响应回来时校验，丢弃仍在飞行中的旧筛选结果
	let reqId = 0;

	// 骨架屏：首屏加载中显示，数据到达后淡出并与内容错位浮现交错
	const { skVisible, skFading, skDone } = useSkeleton();

	// 内容块依次浮现的延迟：卡片按列内序号错开（前 5 张封顶），卡片内各块再按 60ms 递增
	function d(index: number, step: number): string {
		return Math.min(index, 5) * 60 + step * 60 + 'ms';
	}
	const totalCount = computed(() => list.value.length);

	// 骨架屏每列占位高度（rpx，错落模拟瀑布流）
	const skeletonHeights = [[380, 280, 340], [260, 400, 300]];

	// 标签筛选（与云函数 publish 白名单一致）
	const tagList = ['全部', '风景', '人物', '动漫', '萌宠', '美食', '其他'];
	const activeTag = ref('全部');

	// ===== 筛选面板（草稿态在面板内编辑，点确定才写入 applied 生效） =====
	const filterVisible = ref(false);
	const orderOptions = [
		{ label: '最新', value: 'new' },
		{ label: '最热', value: 'hot' },
		{ label: '随机', value: 'random' }
	];
	const dateOptions = [
		{ label: '全部时间', value: 'all' },
		{ label: '近24小时', value: '1d' },
		{ label: '近三天', value: '3d' },
		{ label: '近一周', value: '7d' },
		{ label: '近一月', value: '30d' },
		{ label: '近三月', value: '90d' },
		{ label: '近半年', value: '180d' },
		{ label: '自定义', value: 'custom' }
	];
	// 自定义区间（custom 时用），存 YYYY-MM-DD 字符串
	const todayStr = (() => {
		const d = new Date();
		const p = (n: number): string => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	})();
	const fDateStart = ref('');
	const fDateEnd = ref('');

	function onDateStartChange(e: any) {
		fDateStart.value = e.detail.value;
	}

	function onDateEndChange(e: any) {
		fDateEnd.value = e.detail.value;
	}

	function fmtDateStr(ts: any): string {
		const d = new Date(ts);
		const p = (n: number): string => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	}
	const filterTagOptions = ['风景', '人物', '动漫', '萌宠', '美食', '其他'];
	// 草稿态
	const fOrder = ref('new');
	const fTags = ref<string[]>([]);
	const fDate = ref('all');
	const fAuthor = ref('');
	const fAuthorId = ref(''); // 点联想浮窗选中后的精确 uid（优先于昵称模糊匹配）
	const authorCandidates = ref<any[]>([]); // 昵称联想候选
	let authorSearchTimer: ReturnType<typeof setTimeout> | null = null;
	// 生效态（custom 区间换算成毫秒时间戳存 dateStart/dateEnd）
	const applied = ref<Record<string, any>>({ order: 'new', tags: [], date: 'all', dateStart: 0, dateEnd: 0, author: '', authorId: '' });
	// 随机模式下已展示过的照片 id，回传给云函数排除，避免加载更多时重复
	const seenIds = ref<string[]>([]);

	const hasFilter = computed(() => {
		const a = applied.value;
		return a.order !== 'new' || a.tags.length > 0 || a.date !== 'all' || a.author !== '';
	});

	const emptyTitle = computed(() => {
		if (searchMode.value) return '没有找到相关照片';
		return hasFilter.value ? '没有符合条件的照片' : '还没有照片';
	});
	const emptySub = computed(() => {
		if (searchMode.value) return '换个关键词试试';
		if (hasFilter.value) return '调整筛选条件再看看';
	// wx:audit off 审核期固定文案（原三目依赖 hideComments，注释掉发布引导分支）
	// return hideComments.value ? '先逛逛大家分享的照片吧' : '点击右下角 ＋ 发布第一张吧';
	return '先逛逛大家分享的照片吧';
	// /wx:audit
	});

	function openFilter() {
		// 打开面板时把生效态拷入草稿态
		fOrder.value = applied.value.order;
		fTags.value = applied.value.tags.slice();
		fDate.value = applied.value.date;
		fDateStart.value = applied.value.dateStart ? fmtDateStr(applied.value.dateStart) : '';
		fDateEnd.value = applied.value.dateEnd ? fmtDateStr(applied.value.dateEnd) : '';
		fAuthor.value = applied.value.author;
		fAuthorId.value = applied.value.authorId;
		authorCandidates.value = [];
		filterVisible.value = true;
	}

	function closeFilter() {
		filterVisible.value = false;
		authorCandidates.value = [];
		if (authorSearchTimer) {
			clearTimeout(authorSearchTimer);
			authorSearchTimer = null;
		}
	}

	function toggleFilterTag(t: string) {
		const i = fTags.value.indexOf(t);
		if (i === -1) fTags.value.push(t);
		else fTags.value.splice(i, 1);
	}

	function resetFilter() {
		fOrder.value = 'new';
		fTags.value = [];
		fDate.value = 'all';
		fDateStart.value = '';
		fDateEnd.value = '';
		fAuthor.value = '';
		fAuthorId.value = '';
		authorCandidates.value = [];
	}

	// 昵称输入联想：防抖 300ms，输入一个字也会触发；内容被改动后解除精确锁定
	function onAuthorInput() {
		fAuthorId.value = '';
		if (authorSearchTimer) clearTimeout(authorSearchTimer);
		const kw = fAuthor.value.trim();
		if (!kw) {
			authorCandidates.value = [];
			return;
		}
		authorSearchTimer = setTimeout(() => {
			fetchAuthorCandidates(kw);
		}, 300);
	}

	async function fetchAuthorCandidates(kw: string) {
		try {
			const res = await uniCloud.callFunction({
				name: 'wallpaper-action',
				data: { action: 'searchUsers', keyword: kw }
			});
			const r = res.result || {};
			if (r.errCode) return;
			const list = r.list || [];
			// 头像 fileID 批量换临时地址
			const fileIds = list.filter((u) => u.avatar).map((u) => u.avatar);
			let urlMap = {};
			if (fileIds.length) urlMap = await resolveFileUrls(fileIds);
			authorCandidates.value = list.map((u) => ({ ...u, _avatarUrl: urlMap[u.avatar] || '' }));
		} catch (e) {
			// 联想失败静默，不影响输入
		}
	}

	// 点击候选：精确锁定该用户（authorId 优先于昵称模糊匹配）
	function pickAuthor(u: any) {
		fAuthorId.value = u._id;
		fAuthor.value = u.nickname;
		authorCandidates.value = [];
		if (authorSearchTimer) {
			clearTimeout(authorSearchTimer);
			authorSearchTimer = null;
		}
	}

	// 手动解析 YYYY-MM-DD：iOS 不支持 new Date('YYYY-MM-DD HH:mm:ss') 这种格式
	function parseDateStr(str: string, endOfDay: boolean): number {
		const parts = str.split('-').map((n) => Number(n));
		if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return 0;
		return new Date(
			parts[0],
			parts[1] - 1,
			parts[2],
			endOfDay ? 23 : 0,
			endOfDay ? 59 : 0,
			endOfDay ? 59 : 0
		).getTime();
	}

	function applyFilter() {
		let dateStart = 0;
		let dateEnd = 0;
		if (fDate.value === 'custom') {
			// 自定义区间：开始日期取当天 00:00，结束日期取当天 23:59:59
			if (!fDateStart.value && !fDateEnd.value) {
				uni.showToast({ title: '请选择开始或结束日期', icon: 'none' });
				return;
			}
			dateStart = fDateStart.value ? parseDateStr(fDateStart.value, false) : 0;
			dateEnd = fDateEnd.value ? parseDateStr(fDateEnd.value, true) : 0;
			if (dateStart && dateEnd && dateStart > dateEnd) {
				uni.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
				return;
			}
		}
		applied.value = {
			order: fOrder.value,
			tags: fTags.value.slice(),
			date: fDate.value,
			dateStart,
			dateEnd,
			author: fAuthor.value.trim(),
			authorId: fAuthorId.value
		};
		closeFilter();
		reload();
	}

	// 搜索：searchKeyword 非空即搜索模式（走云函数 search）
	const searchInput = ref('');
	const searchKeyword = ref('');
	const searchMode = computed(() => !!searchKeyword.value);

	const loadmoreText = computed(() => {
		if (loading.value) return '加载中…';
		return hasMore.value ? '上拉加载更多' : '没有更多了';
	});

	// 自定义导航：真机状态栏高度 + 微信胶囊避让
	const statusBarHeight = ref(20);
	// headerStyle：顶部内边距对齐胶囊上边缘（非微信端回退状态栏+12）
	// headerRowStyle：首行与胶囊同高，右侧预留胶囊宽度，标题不会被胶囊遮挡
	const headerStyle = ref<Record<string, string>>({});
	const headerRowStyle = ref<Record<string, string>>({});
	const today = (() => {
		const d = new Date();
		return {
			day: String(d.getDate()).padStart(2, '0'),
			yearMonth: `${d.getFullYear()}年${d.getMonth() + 1}月`,
			week: '星期' + '日一二三四五六'.charAt(d.getDay())
		};
	})();

	try {
		const sys = uni.getSystemInfoSync();
		statusBarHeight.value = sys.statusBarHeight || 20;
		// #ifdef MP-WEIXIN
		try {
			const rect = uni.getMenuButtonBoundingClientRect();
			if (rect && rect.height) {
				headerStyle.value = { paddingTop: rect.top + 'px' };
				headerRowStyle.value = {
					height: rect.height + 'px',
					paddingRight: sys.windowWidth - rect.left + 12 + 'px'
				};
			}
		} catch (e) {}
		// #endif
	} catch (err) {}

	// 非微信端（未取到胶囊时）的回退布局
	if (!headerStyle.value.paddingTop) {
		headerStyle.value = { paddingTop: statusBarHeight.value + 12 + 'px' };
	}

	// scroll-view 自定义下拉刷新状态
	const refreshing = ref(false);

	onLoad(() => {
		reload();
		uni.$on('wallpaperPublished', onPublished);
		uni.$on('photoStatsChanged', onStatsChanged);
	});

	// 页面分享：分享首页入口
	onShareAppMessage(() => ({
		title: '十月初美人鉴赏',
		path: '/pages/Home/index',
		imageUrl: '/static/logo.jpeg'
	}));

	onUnmounted(() => {
		uni.$off('wallpaperPublished', onPublished);
		uni.$off('photoStatsChanged', onStatsChanged);
	});

	// tab 页返回时 onLoad 不会再触发；缓存未过期则跳过刷新
	onShow(() => {
		messageStore.refreshBadge();
		if (Date.now() - lastLoadAt.value > CACHE_TTL) reload();
	});

	// 列表由内部 scroll-view 承载：触底加载、自定义下拉刷新
	function onScrollToLower() {
		if (hasMore.value && !loading.value) loadMore();
	}

	async function onRefresh() {
		if (refreshing.value) return;
		refreshing.value = true;
		try {
			await reload();
		} finally {
			refreshing.value = false;
		}
	}

	// 发布成功后强制刷新（publish.vue 在跳回首页前 emit）
	function onPublished() {
		reload();
	}

	// 详情页点赞/评论变更 → 原地同步瀑布流内对应照片数量
	function onStatsChanged(e: { id: string; likeNum?: number; commentNum?: number }) {
		list.value.forEach((item) => {
			if (item._id !== e.id) return;
			if (!item.info) item.info = {};
			if (typeof e.likeNum === 'number') item.info.likeNum = e.likeNum;
			if (typeof e.commentNum === 'number') item.info.commentNum = e.commentNum;
		});
	}

	function switchTag(t: string) {
		if (activeTag.value === t) return;
		activeTag.value = t;
		// 切换标签时随机态重置 seenIds（新标签下旧排除列表不相关）
		seenIds.value = [];
		reload();
	}

	function doSearch() {
		const kw = searchInput.value.trim();
		if (!kw) return cancelSearch();
		searchKeyword.value = kw;
		reload();
	}

	function cancelSearch() {
		if (!searchMode.value) return;
		searchInput.value = '';
		searchKeyword.value = '';
		reload();
	}

	async function reload() {
		reqId++;
		list.value = [];
		hasMore.value = false;
		seenIds.value = [];
		await loadMore(reqId);
	}

	async function loadMore(forceSeq?: number) {
		const seq = typeof forceSeq === 'number' ? forceSeq : reqId;
		if (seq !== reqId) return;
		// 分页请求需等上一页结束；reload 触发的强制请求可越过该守卫，由序号丢弃旧结果
		if (loading.value && typeof forceSeq !== 'number') return;
		loading.value = true;
		try {
			if (searchMode.value) {
				// 搜索走云函数（描述正则匹配，clientDB 权限不支持模糊查询）
				const res = await uniCloud.callFunction({
					name: 'wallpaper-action',
					data: { action: 'search', keyword: searchKeyword.value, skip: totalCount.value }
				});
				if (seq !== reqId) return;
				const r = res.result || {};
				if (r.errCode) {
					uni.showToast({ title: r.errMsg || '搜索失败', icon: 'none' });
					return;
				}
				await appendRecords(r.list || [], seq);
				if (seq !== reqId) return;
				hasMore.value = !!r.hasMore;
			} else {
				// 信息流走云函数 feed：统一支持排序（new/hot/random）与组合筛选
				const a = applied.value;
				const data: Record<string, any> = {
					action: 'feed',
					sortBy: a.order,
					tags: a.tags,
					authorKeyword: a.author,
					authorId: a.authorId, // 联想浮窗选中的精确 uid，云函数内优先于 authorKeyword
					filterTag: activeTag.value !== '全部' ? activeTag.value : '',
					skip: totalCount.value
				};
				const DAY = 24 * 60 * 60 * 1000;
				// 快捷档位是滚动窗口（此刻往前推 N 天）；自定义区间用已换算好的毫秒时间戳
				const dateDays = { '1d': 1, '3d': 3, '7d': 7, '30d': 30, '90d': 90, '180d': 180 };
				if (a.date === 'custom') {
					if (a.dateStart) data.dateFrom = a.dateStart;
					if (a.dateEnd) data.dateTo = a.dateEnd;
				} else if (dateDays[a.date]) {
					data.dateFrom = Date.now() - dateDays[a.date] * DAY;
				}
				if (a.order === 'random') data.excludeIds = seenIds.value;

				const res = await uniCloud.callFunction({ name: 'wallpaper-action', data });
				if (seq !== reqId) return;
				const r = res.result || {};
				if (r.errCode) {
					uni.showToast({ title: r.errMsg || '加载失败', icon: 'none' });
					return;
				}
				if (a.order === 'random') {
					// 记录已见 id 传给下一页排除；数组封顶防无限增长
					seenIds.value = seenIds.value
						.concat((r.list || []).map((x) => x._id))
						.slice(-300);
				}
				await appendRecords(r.list || [], seq);
				if (seq !== reqId) return;
				hasMore.value = !!r.hasMore;
			}
			lastLoadAt.value = Date.now();
		} catch (e) {
			if (seq !== reqId) return;
			console.error('加载照片列表失败', e);
			uni.showToast({ title: '加载失败，请下拉重试', icon: 'none' });
		} finally {
			if (seq === reqId) {
				loading.value = false;
				skDone(); // 无论成功失败都让骨架淡出，避免卡在加载态
			}
		}
	}

	// 照片与作者头像都是 cloud:// fileID，批量换取临时 https 地址后写入平铺列表，
	// 两列分流与展示高度由 waterfall-list 组件计算
	async function appendRecords(records: any[], seq?: number) {
		// 按 _id 去重：分页期间有新照片插入时，最新/最热排序会出现重复卡片
		const existing = new Set<string>();
		list.value.forEach((c) => existing.add(c._id));
		records = records.filter((r) => r._id && !existing.has(r._id));

		const fileIDs = [];
		records.forEach((r) => {
			if (r.image) fileIDs.push(r.image);
			if (r.author && r.author.avatar) fileIDs.push(r.author.avatar);
		});
		const urlMap = await resolveFileUrls(fileIDs);
		// 换链接期间若已触发刷新，丢弃这批过期数据
		if (typeof seq === 'number' && seq !== reqId) return;

		const cards = records.map((r) => {
			const imgUrl = urlMap[r.image] || '';
			return {
				...r,
				_imgUrl: imgUrl,
				_avatarUrl: (r.author && urlMap[r.author.avatar]) || '',
				// 地址换取失败时不展示蒙版（无 load 事件，避免蒙版永久停留）
				_imgLoaded: !imgUrl
			};
		});
		list.value = list.value.concat(cards);
	}

	// 图片加载完成/失败：移除加载蒙版让整图淡入（失败时只留灰色占位底，不再闪渐进渲染）
	function onImgReady(item: any) {
		item._imgLoaded = true;
	}

	function goRank() {
		uni.navigateTo({ url: '/pages/Rank/rank' });
	}

	function goUserHome(item: any) {
		if (!item.author_id) return;
		uni.navigateTo({ url: '/pages/UserHome/user-home?uid=' + item.author_id });
	}

	function goPublish() {
		uni.navigateTo({ url: '/pages/Publish/publish' });
	}

	function goDetail(id: string) {
		if (!id) return;
		uni.navigateTo({ url: '/pages/Detail/detail?id=' + id });
	}
	</script>
<style lang="scss">
	.content {
		// 锁死页面高度、禁止页面自身滚动：头部固定 + 内部 scroll-view 滚动
		height: 100vh;
		width: 100%;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		background: #f4f6f9;
	}

	/* ===== 固定头部 ===== */
	.header {
		position: relative;
		flex-shrink: 0;
		padding: 0 40rpx 20rpx;
		background-image: linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%);
		border-bottom-left-radius: 36rpx;
		border-bottom-right-radius: 36rpx;
		box-sizing: border-box;

		.header-row {
			display: flex;
			align-items: center;
			width: 100%;
			box-sizing: border-box;
		}

		.title {
			flex: 1;
			min-width: 0;
			font-size: 34rpx;
			font-weight: bold;
			color: #1f5fae;
			letter-spacing: 1rpx;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
	}

	.datelogo {
		margin-top: 24rpx;
		display: flex;
		align-items: center;
		justify-content: space-between;

		.date {
			display: flex;
			align-items: center;

			.dateDay {
				font-size: 92rpx;
				font-weight: bold;
				line-height: 1;
				background: linear-gradient(to left, #7285e5 0%, #2c98e7 100%);
				-webkit-background-clip: text;
				-webkit-text-fill-color: transparent;
			}

			.dateYear {
				margin-left: 16rpx;
				display: flex;
				flex-direction: column;

				.year {
					font-size: 26rpx;
					color: #3a73ad;
				}

				.week {
					margin-top: 8rpx;
					font-size: 28rpx;
					font-weight: bold;
					color: #1f5fae;
				}
			}
		}

		.logo {
			width: 130rpx;
			height: 130rpx;
			border-radius: 50%;
			overflow: hidden;
			background: rgba(255, 255, 255, 0.55);
			display: flex;
			align-items: center;
			justify-content: center;

			image {
				width: 120rpx;
				height: 120rpx;
				border-radius: 50%;
			}
		}
	}

	/* ===== 搜索行：搜索框 + 排行榜入口 ===== */
	.search-row {
		margin-top: 24rpx;
		display: flex;
		align-items: center;
	}

	.search-box {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		background: rgba(255, 255, 255, 0.85);
		border-radius: 36rpx;
		padding: 0 24rpx;
		height: 72rpx;
		box-sizing: border-box;

		.search-input {
			flex: 1;
			min-width: 0;
			margin-left: 12rpx;
			font-size: 26rpx;
			color: #2b3a4a;
		}

		.search-ph {
			color: #a7bfd3;
		}
	}

	.rank-entry {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		margin-left: 16rpx;
		padding: 0 22rpx;
		height: 72rpx;
		border-radius: 36rpx;
		background: rgba(255, 255, 255, 0.75);

		.rank-text {
			margin-left: 6rpx;
			font-size: 24rpx;
			color: #1f5fae;
			font-weight: bold;
			white-space: nowrap;
		}
	}

	.search-cancel {
		flex-shrink: 0;
		margin-left: 16rpx;
		font-size: 26rpx;
		color: #1f5fae;
		white-space: nowrap;
	}

	/* ===== 标签筛选行（固定）：左侧横滑标签 + 右侧筛选按钮 ===== */
	.tag-row {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		padding: 20rpx 20rpx 4rpx;
		box-sizing: border-box;
	}

	.tag-bar {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		box-sizing: border-box;

		.tag-chip {
			display: inline-block;
			padding: 10rpx 30rpx;
			margin-right: 16rpx;
			border-radius: 32rpx;
			background: #fff;
			font-size: 24rpx;
			color: #6b7d8f;
			box-shadow: 0 2rpx 8rpx rgba(31, 95, 174, 0.05);

			&.active {
				background: linear-gradient(90deg, #4facfe 0%, #2c98e7 100%);
				color: #fff;
			}
		}
	}

	.filter-entry {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		margin-left: 14rpx;
		padding: 0 22rpx;
		height: 52rpx;
		border-radius: 32rpx;
		background: #fff;
		box-shadow: 0 2rpx 8rpx rgba(31, 95, 174, 0.05);

		.filter-text {
			margin-left: 6rpx;
			font-size: 24rpx;
			color: #2c98e7;
			white-space: nowrap;
		}

		&.active {
			background: linear-gradient(90deg, #4facfe 0%, #2c98e7 100%);

			.filter-text {
				color: #fff;
			}
		}
	}

	/* ===== 筛选面板（底部弹出） ===== */
	.filter-mask {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.45);
		z-index: 1000;
		display: flex;
		align-items: flex-end;
	}

	.filter-panel {
		width: 100%;
		box-sizing: border-box;
		background: #fff;
		border-top-left-radius: 28rpx;
		border-top-right-radius: 28rpx;
		padding: 32rpx 32rpx 60rpx;

		.filter-head {
			display: flex;
			align-items: center;
			justify-content: center;
			padding-bottom: 24rpx;

			.filter-head-title {
				font-size: 32rpx;
				font-weight: bold;
				color: #2b3a4a;
			}
		}

		.filter-sec-title {
			margin-top: 26rpx;
			font-size: 26rpx;
			font-weight: bold;
			color: #4a5868;
		}

		.opt-row {
			display: flex;
			flex-wrap: wrap;
			margin-top: 16rpx;

			.opt {
				padding: 12rpx 32rpx;
				margin: 0 16rpx 16rpx 0;
				border-radius: 32rpx;
				background: #f2f5f8;
				font-size: 26rpx;
				color: #6b7d8f;

				&.on {
					background: linear-gradient(90deg, #4facfe 0%, #2c98e7 100%);
					color: #fff;
				}
			}
		}

		.filter-author-input {
			margin-top: 16rpx;
			height: 80rpx;
			border-radius: 16rpx;
			background: #f2f5f8;
			padding: 0 24rpx;
			font-size: 26rpx;
			color: #2b3a4a;
			box-sizing: border-box;
			width: 100%;
		}

		.filter-author-ph {
			color: #a7bfd3;
		}

		/* 自定义日期区间：卡片式带图标，选中高亮 */
		.custom-date-row {
			display: flex;
			align-items: center;
			margin-top: 12rpx;

			.date-picker {
				flex: 1;
				display: flex;
				align-items: center;
				justify-content: center;
				height: 80rpx;
				border-radius: 16rpx;
				background: #f7fafc;
				border: 2rpx solid #e6eef5;
				font-size: 26rpx;
				color: #2b3a4a;
				transition: all 0.2s;

				&.placeholder {
					color: #a7bfd3;
				}

				&:active {
					background: #eef6ff;
					border-color: #2c98e7;
				}
			}

			.date-sep {
				margin: 0 20rpx;
				font-size: 24rpx;
				color: #9aa7b4;
				font-weight: bold;
			}
		}

		/* 昵称联想浮窗：绝对定位覆盖在输入框上方，不挤压布局；自身限高可滚动 */
	.author-search-box {
		position: relative;
	}

	.author-popup {
		position: absolute;
		bottom: calc(100% + 12rpx);
		left: 0;
		right: 0;
		max-height: 440rpx;
		background: #fff;
		border: 2rpx solid #e6eef5;
		border-radius: 16rpx;
		box-shadow: 0 -4rpx 24rpx rgba(0, 0, 0, 0.1);
		z-index: 20;
		overflow: hidden;

			.author-item {
				display: flex;
				align-items: center;
				padding: 18rpx 24rpx;
				border-bottom: 1rpx solid #f2f5f8;

				&:last-child {
					border-bottom: none;
				}

				.author-avatar {
					width: 48rpx;
					height: 48rpx;
					border-radius: 50%;
					background: #f2f8fe;
					flex-shrink: 0;
				}

				.author-avatar-default {
					display: flex;
					align-items: center;
					justify-content: center;
				}

				.author-item-name {
					margin-left: 16rpx;
					font-size: 26rpx;
					color: #2b3a4a;
					overflow: hidden;
					white-space: nowrap;
					text-overflow: ellipsis;
				}
			}
		}

		.filter-btns {
			display: flex;
			margin-top: 40rpx;

			.btn {
				flex: 1;
				height: 84rpx;
				line-height: 84rpx;
				text-align: center;
				border-radius: 42rpx;
				font-size: 30rpx;

				&.reset {
					background: #f2f5f8;
					color: #6b7d8f;
					margin-right: 24rpx;
				}

				&.ok {
					background: linear-gradient(90deg, #4facfe 0%, #2c98e7 100%);
					color: #fff;
					font-weight: bold;
				}
			}
		}
	}

	.search-tip {
		flex-shrink: 0;
		padding: 20rpx 28rpx 4rpx;
		font-size: 24rpx;
		color: #8a97a6;
	}

	/* ===== 图片列表滚动区：占满剩余高度，仅此处纵向滚动 ===== */
	.list-scroll {
		flex: 1;
		min-height: 0;
		width: 100%;
		box-sizing: border-box;
	}

	/* 加载层容器：骨架层绝对定位覆盖其上 */
	.feed {
		position: relative;
	}

	/* 加载期撑住高度：骨架层绝对定位不占位，避免内容到达时页面塌陷跳动 */
	.feed-loading {
		min-height: 1200rpx;
	}

	/* 骨架层底色跟随本页页面底色，避免淡出时出现色差闪白 */
	.sk-layer {
		background: #f4f6f9;
	}

	/* ===== 双列瀑布流 ===== */
	.wf {
		display: flex;
		align-items: flex-start;
		padding: 20rpx;
		box-sizing: border-box;

		.wf-col {
			flex: 1;
			min-width: 0;

			& + .wf-col {
				margin-left: 20rpx;
			}
		}

		.listBox {
			background: #ffffff;
			border-radius: 20rpx;
			overflow: hidden;
			box-shadow: 0 6rpx 20rpx rgba(31, 95, 174, 0.08);

			.photo {
				position: relative;
				width: 100%;
				background: #eef2f7;

				image {
					display: block;
					width: 100%;
					height: 100%;
					// 未就绪时透明，避免看到图片渐进渲染；就绪后整图以 ease-out 淡入
					opacity: 0;
					transition: opacity 0.42s cubic-bezier(0.22, 0.61, 0.36, 1);

					&.img-in {
						opacity: 1;
					}
				}

				/* 同色模糊加载蒙版：复用全局斜向扫光，图片淡入时蒙版同步淡出 */
				.img-mask {
					position: absolute;
					top: 0;
					left: 0;
					right: 0;
					bottom: 0;
					overflow: hidden;
					background: linear-gradient(100deg, #e8edf4 0%, #f0f4f9 45%, #e8edf4 100%);
					// 离场快于入场（0.3s < 0.42s），ease-in 加速退去
					transition: opacity 0.3s cubic-bezier(0.7, 0, 0.84, 0);

					&.mask-out {
						opacity: 0;
						pointer-events: none;

						.sk-shine {
							animation-play-state: paused;
						}
					}
				}
			}

			.description {
				padding: 16rpx 20rpx 0;
				font-size: 26rpx;
				line-height: 1.4;
				color: #2b3a4a;
				overflow: hidden;
				white-space: nowrap;
				text-overflow: ellipsis;
			}

			.info {
				padding: 14rpx 20rpx 18rpx;
				display: flex;
				align-items: center;
				justify-content: space-between;

				.author {
					display: flex;
					align-items: center;
					flex: 1;
					min-width: 0;

					.author-avatar {
						width: 36rpx;
						height: 36rpx;
						border-radius: 50%;
						flex-shrink: 0;
						background: #eef2f7;
					}

					.author-name {
						margin-left: 10rpx;
						font-size: 22rpx;
						color: #8a97a6;
						overflow: hidden;
						text-overflow: ellipsis;
						white-space: nowrap;
					}
				}

				.like {
					display: flex;
					align-items: center;
					flex-shrink: 0;
					margin-left: 12rpx;

					.stat {
						display: flex;
						align-items: center;

						&:last-child {
							margin-left: 16rpx;
						}

						.stat-num {
							margin-left: 4rpx;
							font-size: 22rpx;
							color: #9aa7b4;
						}

						/* 当前用户已点赞：图标与数字都变红 */
						&.liked .stat-num {
							color: #e65a5a;
						}
					}
				}
			}
		}
	}

	/* ===== 骨架屏 ===== */
	/* 灰块底与斜向扫光由全局 .sk / .sk-shine 提供，这里只定形状 */
	.sk-layer .listBox {
		margin-bottom: 20rpx;
	}

	.sk-photo {
		width: 100%;
		// 高度由骨架屏内联 style 给定（错落模拟瀑布流）
	}

	.sk-line {
		height: 26rpx;
		border-radius: 8rpx;
		margin: 16rpx 20rpx 0;
	}

	.sk-line.short {
		width: 50%;
		margin-bottom: 20rpx;
	}

	/* ===== 空态 ===== */
	.empty {
		width: 100%;
		padding: 200rpx 0 40rpx;
		display: flex;
		flex-direction: column;
		align-items: center;
		box-sizing: border-box;

		.empty-title {
			font-size: 32rpx;
			color: #7fa9c9;
		}

		.empty-sub {
			margin-top: 16rpx;
			font-size: 26rpx;
			color: #a7bfd3;
		}
	}

	.loadmore {
		text-align: center;
		font-size: 24rpx;
		color: #a7bfd3;
		padding: 0 0 60rpx;
	}

	/* ===== 悬浮发布按钮 ===== */
	.fab {
		position: fixed;
		right: 40rpx;
		bottom: 60rpx;
		width: 96rpx;
		height: 96rpx;
		border-radius: 50%;
		background: linear-gradient(135deg, #4facfe 0%, #2c98e7 100%);
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 10rpx 28rpx rgba(44, 152, 231, 0.5);
		z-index: 999;
	}
</style>