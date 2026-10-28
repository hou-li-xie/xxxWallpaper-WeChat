<template>
	<view class="page">
		<!-- 骨架层绝对定位覆盖其上，加载期给容器撑高避免塌陷跳动 -->
		<view class="feed" :class="{ 'feed-loading': skVisible }">
		<!-- 大图：点击/长按均可全屏预览，预览中长按图片可保存到相册（微信内置能力） -->
		<view class="hero reveal-blk" :style="{ animationDelay: d(0) }">
			<image
			class="hero-img"
			:src="wallpaper._imgUrl"
			mode="aspectFill"
			:style="{ height: heroHeightPx + 'px' }"
			@click="previewHero"
			@longpress="previewHero"
		></image>
			<view class="hero-tip">
				<uni-icons type="info" size="12" color="#fff"></uni-icons>
				<text>长按图片可保存</text>
			</view>
			<!-- 收藏 / 举报 悬浮入口（保存走大图长按；分享已按需求关闭，不定义分享回调即不可转发） -->
			<view class="hero-ops">
				<view class="hero-op" @click="onToggleFavorite">
					<uni-icons :type="favorited ? 'star-filled' : 'star'" size="20" :color="favorited ? '#ffce3d' : '#fff'"></uni-icons>
				</view>
				<view class="hero-op" @click="openReport">
					<uni-icons type="flag" size="20" color="#fff"></uni-icons>
				</view>
			</view>
		</view>

		<!-- 作者 + 描述 -->
		<view class="card author-card">
			<view class="author reveal-blk" :style="{ animationDelay: d(1) }" @click="goUserHome">
				<image v-if="wallpaper._avatarUrl" class="avatar" :src="wallpaper._avatarUrl" mode="aspectFill"></image>
				<view v-else class="avatar avatar-default">
					<uni-icons type="person-filled" size="20" color="#c2ccd8"></uni-icons>
				</view>
				<text class="name">{{ wallpaper.author ? wallpaper.author.name : '匿名' }}</text>
			</view>
			<view v-if="wallpaper.description" class="desc reveal-blk" :style="{ animationDelay: d(2) }">{{ wallpaper.description }}</view>

			<!-- 标签 -->
			<view v-if="wallpaper.tags && wallpaper.tags.length" class="tag-row">
				<text v-for="t in wallpaper.tags" :key="t" class="tag-chip">#{{ t }}</text>
			</view>

			<!-- 照片元信息：浏览量 / 分辨率 / 发布时间（纯工具属性） -->
			<view class="meta-row reveal-blk" :style="{ animationDelay: d(3) }">
				<view class="meta-item">
					<uni-icons type="eye" size="14" color="#8fa3b5"></uni-icons>
					<text class="meta-text">{{ viewCount }} 浏览</text>
				</view>
				<view v-if="wallpaper.width && wallpaper.height" class="meta-item">
					<uni-icons type="image" size="14" color="#8fa3b5"></uni-icons>
					<text class="meta-text">{{ wallpaper.width }}×{{ wallpaper.height }}</text>
				</view>
				<view class="meta-item">
					<uni-icons type="calendar" size="14" color="#8fa3b5"></uni-icons>
					<text class="meta-text">{{ formatDate(wallpaper.createTime) }}</text>
				</view>
			</view>

			<!-- 保存引导：大图预览中长按即可保存（微信内置能力，无需额外授权配置） -->
			<view class="save-tip" @click="previewHero">
				<uni-icons type="download" size="15" color="#2c98e7"></uni-icons>
				<text>点击预览大图，长按可保存到相册</text>
			</view>
		</view>

		<!-- wx:audit off 审核期屏蔽评论区
		<view v-if="!hideComments" class="card comment-card reveal-blk" :style="{ animationDelay: d(4) }">
			<view class="section-title">
				<text>评论 {{ commentCount }}</text>
			</view>

			<view v-if="!comments.length && !loading" class="comment-empty">
				<text>还没有评论，快来抢沙发~</text>
			</view>

			<view v-for="c in comments" :key="c._id" class="comment-item fade-up">
				<image v-if="c._avatarUrl" class="c-avatar" :src="c._avatarUrl" mode="aspectFill"></image>
				<view v-else class="c-avatar c-avatar-default">
					<uni-icons type="person-filled" size="16" color="#c2ccd8"></uni-icons>
				</view>
				<view class="c-body">
					<text class="c-name">{{ c.author ? c.author.name : '用户' }}</text>
					<text class="c-content">{{ c.content }}</text>
					<view class="c-meta">
						<text class="c-time">{{ formatTime(c.create_time) }}</text>
						<text class="c-reply-entry" @click="onReplyComment(c)">回复</text>
						<text v-if="c.user_id === myUid" class="c-delete-entry" @click.stop="onDeleteComment(c)">删除</text>
					</view>

					<view v-if="c.replies && c.replies.length" class="reply-block">
						<view
							v-for="r in visibleReplies(c)"
							:key="r._id"
							class="reply-item"
							@click="onReplyReply(c, r)"
						><text class="r-name">{{ r.author ? r.author.name : '用户' }}</text><text v-if="!isDirectReply(c, r)" class="r-to"> 回复 <text class="r-toname">@{{ r.reply_to ? r.reply_to.name : '用户' }}</text></text><text class="r-colon">：</text><text class="r-content">{{ r.content }}</text><text class="r-time"> {{ formatTime(r.create_time) }}</text><text v-if="r.user_id === myUid" class="r-delete" @click.stop="onDeleteReply(c, r)"> 删除</text></view>
						<view
							v-if="c.replies.length > 2 && !expanded[c._id]"
							class="reply-more"
							@click.stop="toggleExpand(c._id)"
						>
							<text>展开更多 {{ c.replies.length - 2 }} 条回复</text>
						</view>
						<view
							v-else-if="expanded[c._id] && c.replies.length > 2"
							class="reply-more"
							@click.stop="toggleExpand(c._id)"
						>
							<text>收起回复</text>
						</view>
					</view>
				</view>
			</view>

			<view v-if="hasMore" class="loading-tip" @click="loadComments(true)">加载更多评论</view>
		</view>
		
		<!-- /wx:audit -->

		<!-- 骨架屏：形状与真实内容一致（大图 + 头像行 + 描述/统计文字），共用一道斜向光带 -->
		<view v-if="skVisible" class="sk-layer" :class="{ 'sk-out': skFading }">
			<view class="sk sk-hero"></view>
			<view class="sk-row">
				<view class="sk sk-avatar"></view>
				<view class="sk-col">
					<view class="sk sk-line"></view>
					<view class="sk sk-line short"></view>
				</view>
			</view>
			<view class="sk sk-line"></view>
			<view class="sk sk-line short"></view>
			<view class="sk-shine"></view>
		</view>
		</view>

		<!-- 相关推荐：同标签照片横滑（内容分发，非社交） -->
		<view v-if="relatedList.length" class="card related-card">
			<view class="section-title">
				<text>相关推荐</text>
			</view>
			<scroll-view scroll-x class="related-scroll" :show-scrollbar="false">
				<view class="related-inner">
					<view
						v-for="r in relatedList"
						:key="r._id"
						class="related-item"
						@click="goRelated(r._id)"
					>
						<image class="related-img" :src="r._imgUrl" mode="aspectFill" lazy-load></image>
						<text class="related-desc">{{ r.description || '未命名照片' }}</text>
					</view>
				</view>
			</scroll-view>
		</view>

		<!-- 底部占位，防止内容被固定栏遮挡 -->
		<view class="bottom-holder" :style="{ height: 56 + safeBottom + 'px' }"></view>

		<!-- 底部操作栏：点赞 + 评论输入（评论随 hide_content 开关隐藏） -->
		<view class="bottom-wrap" :style="{ paddingBottom: safeBottom + 'px' }">
			<!-- wx:audit off 审核期屏蔽回复提示条
			<view v-if="!hideComments && replyTarget" class="reply-chip">
				<text class="chip-text">回复 @{{ replyTarget.name }}</text>
				<text class="chip-cancel" @click="cancelReply">取消</text>
			</view>
			
			<!-- /wx:audit -->
			<view class="bottom-bar">
				<view class="like-btn" @click="onToggleLike">
					<uni-icons
						:key="likeCount + '-' + liked"
						class="pop-anim"
						:type="liked ? 'heart-filled' : 'heart'"
						size="24"
						:color="liked ? '#ff4d5e' : '#7a8794'"
					></uni-icons>
					<text class="like-num" :class="{ active: liked }">{{ likeCount }}</text>
				</view>
				<!-- wx:audit off 审核期屏蔽评论输入
				<template v-if="!hideComments">
					<input
						class="comment-input"
						v-model="draft"
						:placeholder="replyTarget ? '回复 @' + replyTarget.name + '：' : '说点什么...'"
						:maxlength="100"
						:focus="inputFocus"
						confirm-type="send"
						@confirm="onSendComment"
						@focus="onInputFocus"
						@blur="onInputBlur"
					/>
					<view class="send-btn" :class="{ disabled: !draft.trim() || sending }" @click="onSendComment">
						发送
					</view>
				</template>
				
				<!-- /wx:audit -->
			</view>
		</view>

		<!-- 举报弹窗 -->
		<view v-if="reportVisible" class="dialog-mask" @click="reportVisible = false">
			<view class="dialog" @click.stop>
				<view class="dialog-title">举报这张照片</view>
				<view class="report-reasons">
					<view
						v-for="r in reportReasons"
						:key="r"
						class="reason-chip"
						:class="{ active: reportReason === r }"
						@click="reportReason = r"
					>
						{{ r }}
					</view>
				</view>
				<textarea
					v-model="reportText"
					class="dialog-textarea"
					maxlength="100"
					placeholder="补充说明（选填，最多100字）"
					auto-height
				/>
				<view class="dialog-btns">
					<view class="dialog-btn cancel" @click="reportVisible = false">取消</view>
					<view class="dialog-btn danger" @click="submitReport">提交举报</view>
				</view>
			</view>
		</view>
	</view>
</template>

<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import { onLoad, onShareAppMessage } from '@dcloudio/uni-app';
import { requireLogin } from '../../utils/auth';
import { resolveFileUrls } from '../../utils/cloud-file';
import { formatTime, formatDate } from '../../utils/format-time';
import { useUserStore } from '../../store/user';
import { storeToRefs } from 'pinia';
import { useAppConfigStore } from '../../store/app-config';
import { useSkeleton } from '../../utils/skeleton';

const wallpaperId = ref('');
const wallpaper = ref<Record<string, any>>({});
// 大图展示高度：按图片真实宽高比自适应（横图横显），极端比例做钳制，历史数据回退 375:400
const winWidth = uni.getSystemInfoSync().windowWidth;
const heroHeightPx = computed(() => {
	const w = Number(wallpaper.value.width);
	const h = Number(wallpaper.value.height);
	const ratio = w > 0 && h > 0 ? w / h : 375 / 400;
	const clamped = Math.min(Math.max(ratio, 0.55), 1.35);
	return Math.round(winWidth / clamped);
});
// wx:audit off 审核期注释：hideComments 变量无引用
// 评论开关：true=隐藏评论（app_config.hide_content 控制，默认隐藏兜底，读取失败也按隐藏）
// const appStore = useAppConfigStore();
// const { hideContent: hideComments } = storeToRefs(appStore);
// /wx:audit

// 骨架屏：详情首屏加载中显示，数据到达后淡出并与内容错位浮现交错
const { skVisible, skFading, skDone } = useSkeleton();

// 内容块依次浮现的延迟：从上到下每块错开 60ms
function d(step: number): string {
	return step * 60 + 'ms';
}

// 登录态：从全局 store 响应式读取，登录/登出自动同步
const userStore = useUserStore();
const { userInfo } = storeToRefs(userStore);
const comments = ref<any[]>([]);
const liked = ref(false);
const likeCount = ref(0);
const commentCount = ref(0);
const favorited = ref(false);
// 浏览量与相关推荐（非社交的工具/内容向数据）
const viewCount = ref(0);
const relatedList = ref<any[]>([]);
const VIEW_TTL = 10 * 60 * 1000; // 同一照片 10 分钟内只计一次浏览
const VIEW_MAP_KEY = 'viewed_map_v1'; // 所有照片共用一份浏览记录，避免每张照片一个 storage key
const VIEW_MAP_MAX = 200; // 最多保留 200 条，按最近浏览时间裁剪
const draft = ref('');
const sending = ref(false);
const loading = ref(false);
const liking = ref(false); // 点赞独立 loading，避免评论加载中无法点赞
const favoriting = ref(false); // 收藏防重复点击
const hasMore = ref(false);
// 评论分页游标：按服务端已拉取的顶级评论条数推进，本地增删时同步修正
let rawSkip = 0;
const safeBottom = ref(0);
// 回复目标：null=发顶级评论；否则 { type:'comment'|'reply', parentId, replyId, name }
// 显式记录目标类型，不靠扫描 replies 推断（避免 commentId/replyId 混用误判）
const replyTarget = ref<{ type: string; parentId: string; replyId: string; name: string } | null>(null);
const inputFocus = ref(false);
// 各评论回复区是否展开：{ [commentId]: true }
const expanded = ref<Record<string, boolean>>({});
// 当前登录用户ID（用于判断评论/回复归属，展示删除入口），随登录态响应式更新
const myUid = computed<string>(() => (userInfo.value && userInfo.value._id) || '');
// 微信一次性订阅消息模板ID（发评论点击链路中顺带请求授权，累积可接收条数）
const subTmplId = ref('');

// 未登录用户在登录页登录成功后，本页（仍留在路由栈中）刷新点赞态
// 监听与解绑必须在 setup 同步阶段注册，放在 onLoad 回调里会导致 onUnmounted 无法生效
function onLoginSuccess() {
	rawSkip = 0;
	loadDetail();
	// wx:audit off 审核期不拉取评论
	// if (!hideComments.value) loadComments();
	// /wx:audit
}
uni.$on('loginSuccess', onLoginSuccess);
onUnmounted(() => {
	uni.$off('loginSuccess', onLoginSuccess);
});

onLoad((options: any) => {
	if (options && options.id) {
		wallpaperId.value = options.id;
		try {
			const sys = uni.getSystemInfoSync();
			safeBottom.value = (sys.safeAreaInsets && sys.safeAreaInsets.bottom) || 0;
		} catch (err) {}
		loadDetail();
		// wx:audit off 审核期不拉取评论与订阅模板
		// appStore.init().then(() => {
		// 	if (!appStore.hideContent) {
		// 		loadComments();
		// 		loadSubInfo();
		// 	}
		// });
		// /wx:audit
	}
});

// 页面分享：分享当前照片；图片地址未就绪时回退到 logo
onShareAppMessage(() => {
	const desc = (wallpaper.value.description || '').trim();
	return {
		title: desc || '分享一张美照',
		path: '/pages/Detail/detail?id=' + wallpaperId.value,
		imageUrl: wallpaper.value._imgUrl || '/static/logo.jpeg'
	};
});

function call(action: string, data: Record<string, any> = {}): Promise<any> {
	return uniCloud.callFunction({
		name: 'wallpaper-action',
		data: { action, id: wallpaperId.value, ...data }
	}).then((res) => res.result);
}

// ============ 评论回复提醒订阅 ============
async function loadSubInfo() {
	try {
		const res = await call('subscribeInfo');
		if (res && res.errCode === 0) subTmplId.value = res.templateId || '';
	} catch (e) {
		// 模板信息拉取失败不影响评论功能
	}
}

/**
 * 在用户点击「发送」的手势链路内请求一次微信回复提醒授权。
 * 微信为一次性订阅：每授权一次服务端可下发1条；用户在弹窗勾选「总是保持以上选择」后，
 * 之后每次调用直接成功、无感累积额度。拒绝/失败均不阻断评论发送。
 */
function tryRequestSubscribeInTap() {
	// #ifdef MP-WEIXIN
	if (!subTmplId.value) return Promise.resolve();
	return new Promise((resolve) => {
		uni.requestSubscribeMessage({
			tmplIds: [subTmplId.value],
			success: async (res) => {
				if (res && res[subTmplId.value] === 'accept') {
					try {
						await call('saveSubscribe');
					} catch (e) {
						// 额度登记失败不阻断发送
					}
				}
				resolve();
			},
			fail: () => resolve()
		});
	});
	// #endif
	// #ifndef MP-WEIXIN
	return Promise.resolve();
	// #endif
}

async function loadDetail() {
	try {
		const res = await call('detail');
		if (res.errCode !== 0) {
			uni.showToast({ title: res.errMsg || '加载失败', icon: 'none' });
			return;
		}
		const wp = res.wallpaper || {};
			const avatarId = wp.author && wp.author.avatar;
			const urlMap = await resolveFileUrls([wp.image, avatarId].filter(Boolean));
			wallpaper.value = {
				...wp,
				_imgUrl: urlMap[wp.image] || '',
				_avatarUrl: avatarId ? (urlMap[avatarId] || '') : ''
			};
			liked.value = !!res.liked;
		favorited.value = !!res.favorited;
		likeCount.value = res.likeCount || (wp.info && wp.info.likeNum) || 0;
		commentCount.value = res.commentCount || 0;
		viewCount.value = res.viewCount || 0;
		// 浏览计数（已过审照片才计）+ 相关推荐，均不阻塞详情渲染
		if (wp.audit_status === 1) {
			recordView(wp._id);
			loadRelated(wp._id);
		}
	} catch (e) {
		uni.showToast({ title: (e && e.message) || '详情加载失败', icon: 'none' });
	} finally {
		skDone(); // 无论成功失败都让骨架淡出，避免卡在加载态
	}
}

// 浏览量 +1：本地按照片 10 分钟去重；记录合并存在一个 map 中并定期裁剪
function readViewMap(): Record<string, number> {
	try {
		const raw = uni.getStorageSync(VIEW_MAP_KEY);
		return raw && typeof raw === 'object' ? raw : {};
	} catch (e) {
		return {};
	}
}

async function recordView(wid: string) {
	try {
		const now = Date.now();
		const map = readViewMap();
		const last = Number(map[wid]) || 0;
		if (now - last < VIEW_TTL) return;
		// 只保留最近 24 小时内的记录，并按时间倒序截断，防止 storage 无限增长
		const valid = Object.entries(map)
			.filter(([, t]) => now - Number(t) < 24 * 60 * 60 * 1000)
			.sort((a, b) => Number(b[1]) - Number(a[1]))
			.slice(0, VIEW_MAP_MAX - 1);
		const next: Record<string, number> = {};
		valid.forEach(([k, v]) => {
			next[k] = Number(v);
		});
		next[wid] = now;
		uni.setStorageSync(VIEW_MAP_KEY, next);
		const res = await call('recordView');
		if (res && res.errCode === 0 && res.viewCount) viewCount.value = res.viewCount;
	} catch (e) {
		// 计数失败静默
	}
}

// 相关推荐：拉取后批量换取图片地址
async function loadRelated(wid: string) {
	try {
		const res = await call('related');
		if (res.errCode !== 0 || !(res.list || []).length) return;
		const fileIds = [];
		res.list.forEach((r) => {
			if (r.image) fileIds.push(r.image);
		});
		const urlMap = await resolveFileUrls(fileIds);
		relatedList.value = res.list.map((r) => ({
			...r,
			_imgUrl: urlMap[r.image] || ''
		}));
	} catch (e) {
		// 推荐失败静默
	}
}

// 相关推荐跳转：redirectTo 替换当前详情页，避免连续点推荐导致页面栈无限叠加
function goRelated(rid: string) {
	uni.redirectTo({ url: '/pages/Detail/detail?id=' + rid });
}

// 照片信息卡用发布日期（formatDate），评论区用相对时间（formatTime）

// ============ 评论列表加载 ============
async function loadComments(append: boolean = false) {
	if (loading.value) return;
	loading.value = true;
	try {
		const res = await call('comments', { skip: append ? rawSkip : 0 });
		if (res.errCode === 0) {
			// 批量换取评论者 + 回复者头像
			const avatarIds = [];
			(res.list || []).forEach((c) => {
				if (c.author && c.author.avatar) avatarIds.push(c.author.avatar);
				(c.replies || []).forEach((r) => {
					if (r.author && r.author.avatar) avatarIds.push(r.author.avatar);
				});
			});
			const urlMap = await resolveFileUrls(avatarIds);
			const mapAvatar = (u) => (u && u.avatar ? urlMap[u.avatar] || '' : '');
			const mapped = (res.list || []).map((c) => ({
				...c,
				replies: (c.replies || []).map((r) => ({ ...r, _avatarUrl: mapAvatar(r.author) })),
				_avatarUrl: mapAvatar(c.author)
			}));
			const rows = res.list || [];
			comments.value = append ? comments.value.concat(mapped) : mapped;
			// 游标按服务端原始条数推进；本页新增/删除评论时另行修正
			rawSkip = append ? rawSkip + rows.length : rows.length;
			hasMore.value = !!res.hasMore;
		}
	} catch (e) {
		uni.showToast({ title: '评论加载失败', icon: 'none' });
	} finally {
		loading.value = false;
	}
}

// 点赞 / 取消点赞（乐观更新，失败回滚）
function loginGuard() {
	return requireLogin('/pages/Detail/detail?id=' + wallpaperId.value);
}

async function onToggleLike() {
	if (!loginGuard()) return;
	if (liking.value) return; // 只拦点赞重复点击，不受评论加载影响
	liking.value = true;

	const prevLiked = liked.value;
	const prevCount = likeCount.value;
	liked.value = !prevLiked;
	likeCount.value = Math.max(0, prevCount + (prevLiked ? -1 : 1));

	try {
		const res = await call('toggleLike');
		if (res.errCode !== 0) {
			liked.value = prevLiked;
			likeCount.value = prevCount;
			uni.showToast({ title: res.errMsg || '操作失败', icon: 'none' });
			return;
		}
		liked.value = res.liked;
			likeCount.value = res.likeCount;
			// 广播给列表页（首页/收藏/我的上传）原地同步点赞数，返回时无需刷新
			uni.$emit('photoStatsChanged', { id: wallpaperId.value, likeNum: likeCount.value });
	} catch (e) {
		liked.value = prevLiked;
		likeCount.value = prevCount;
		uni.showToast({ title: '网络异常，请重试', icon: 'none' });
	} finally {
		liking.value = false;
	}
}

// ============ 评论/回复/删除交互 ============
// 点击评论的「回复」：回复该顶级评论
function onReplyComment(c: any) {
	if (!loginGuard()) return;
	replyTarget.value = {
		type: 'comment',
		parentId: c._id,
		replyId: '',
		name: (c.author && c.author.name) || '用户'
	};
	inputFocus.value = true;
}

// 点击某条回复：回复该回复（仍挂在同一顶级评论下）
function onReplyReply(c: any, r: any) {
	if (!loginGuard()) return;
	replyTarget.value = {
		type: 'reply',
		parentId: c._id,
		replyId: r._id,
		name: (r.author && r.author.name) || '用户'
	};
	inputFocus.value = true;
}

function cancelReply() {
	replyTarget.value = null;
	draft.value = '';
}

function onInputFocus() {
	loginGuard();
}

function onInputBlur() {
	inputFocus.value = false;
}

// 回复区折叠：未展开只露前2条
function visibleReplies(c: any): any[] {
	const rs = Array.isArray(c.replies) ? c.replies : [];
	return expanded.value[c._id] ? rs : rs.slice(0, 2);
}

function toggleExpand(cid: string) {
	expanded.value[cid] = !expanded.value[cid];
}

// 被回复人就是顶级评论作者时，按「直接回复」样式展示，不显示 @
function isDirectReply(c: any, r: any): boolean {
	return !r.reply_to || r.reply_to.uid === c.user_id;
}

async function onSendComment() {
	const text = draft.value.trim();
	if (!text || sending.value) return;
	if (!loginGuard()) return;

	const target = replyTarget.value;
	sending.value = true;
	try {
		// 在点击手势链路内顺带请求回复提醒授权（拒绝/失败均不阻断评论发送）
		await tryRequestSubscribeInTap();

		const payload: Record<string, any> = { content: text };
		if (target) {
			payload.parentId = target.parentId;
			if (target.replyId) payload.replyId = target.replyId;
		}
		const res = await call('addComment', payload);
		if (res.errCode !== 0) {
			uni.showToast({ title: res.errMsg || '评论失败', icon: 'none' });
			return;
		}
		// 新评论/回复带头像本地地址
		const nc = res.comment || {};
		const avatarId = nc.author && nc.author.avatar;
		let avatarUrl = '';
		if (avatarId) {
			const urlMap = await resolveFileUrls([avatarId]);
			avatarUrl = urlMap[avatarId] || '';
		}

		if (nc.parent_id) {
			// 回复：挂到对应顶级评论下，并自动展开让新回复可见
			const parent = comments.value.find((c) => c._id === nc.parent_id);
			if (parent) {
				if (!Array.isArray(parent.replies)) parent.replies = [];
				parent.replies.push({ ...nc, _avatarUrl: avatarUrl });
				expanded.value[parent._id] = true;
			}
			uni.showToast({ title: '回复成功', icon: 'success' });
		} else {
			// 顶级评论插到列表最前；服务端条数 +1，游标同步推进，避免下次分页跳过一条
			comments.value.unshift({ ...nc, replies: [], _avatarUrl: avatarUrl });
			rawSkip += 1;
			uni.showToast({ title: '评论成功', icon: 'success' });
		}
		commentCount.value += 1;
		// 广播给列表页原地同步评论数
		uni.$emit('photoStatsChanged', { id: wallpaperId.value, commentNum: commentCount.value });
		draft.value = '';
		replyTarget.value = null;
	} catch (e) {
		uni.showToast({ title: '网络异常，请重试', icon: 'none' });
	} finally {
		sending.value = false;
	}
}

// 删除自己的顶级评论（云函数会级联删除其下回复）
function onDeleteComment(c: any) {
	uni.showModal({
		title: '提示',
		content: (c.replies && c.replies.length)
			? '删除该评论及其全部回复？'
			: '确定删除这条评论吗？',
		confirmColor: '#e65a5a',
		success: (r) => {
			if (r.confirm) doDelete(c._id);
		}
	});
}

// 删除自己的某条回复
function onDeleteReply(c: any, r: any) {
	uni.showModal({
		title: '提示',
		content: '确定删除这条回复吗？',
		confirmColor: '#e65a5a',
		success: (res) => {
			if (res.confirm) doDelete(r._id);
		}
	});
}

async function doDelete(cid: string) {
	try {
		uni.showLoading({ title: '删除中...', mask: true });
		const res = await call('deleteComment', { commentId: cid });
		uni.hideLoading();
		if (res.errCode !== 0) {
			uni.showToast({ title: res.errMsg || '删除失败', icon: 'none' });
			return;
		}
		if (res.parentId) {
			// 删除的是回复：从父评论 replies 中移除
			const parent = comments.value.find((c) => c._id === res.parentId);
			if (parent && Array.isArray(parent.replies)) {
				parent.replies = parent.replies.filter((r) => r._id !== cid);
			}
			commentCount.value = Math.max(0, commentCount.value - 1);
		} else {
			// 删除的是顶级评论：整条（含盖楼）移除；服务端条数 -1，游标同步回退
			comments.value = comments.value.filter((c) => c._id !== cid);
			rawSkip = Math.max(0, rawSkip - 1);
			commentCount.value = Math.max(0, commentCount.value - (1 + (res.removedReplies || 0)));
		}
		// 广播给列表页原地同步评论数
		uni.$emit('photoStatsChanged', { id: wallpaperId.value, commentNum: commentCount.value });
		// 若正在回复被删内容，清空回复态
		if (replyTarget.value && (replyTarget.value.parentId === cid || replyTarget.value.replyId === cid)) {
			replyTarget.value = null;
			draft.value = '';
		}
		uni.showToast({ title: '已删除', icon: 'success' });
	} catch (e) {
		uni.hideLoading();
		uni.showToast({ title: '网络异常，请重试', icon: 'none' });
	}
}

function previewHero() {
	if (wallpaper.value._imgUrl) {
		uni.previewImage({ urls: [wallpaper.value._imgUrl] });
	}
}

/* ============ 收藏（乐观更新，失败回滚） ============ */
async function onToggleFavorite() {
	if (!loginGuard()) return;
	if (favoriting.value) return;
	favoriting.value = true;
	const prev = favorited.value;
	favorited.value = !prev;
	try {
		const res = await call('toggleFavorite');
		if (res.errCode !== 0) {
			favorited.value = prev;
			uni.showToast({ title: res.errMsg || '操作失败', icon: 'none' });
			return;
		}
		favorited.value = !!res.favorited;
		uni.showToast({ title: favorited.value ? '已收藏' : '已取消收藏', icon: 'none' });
	} catch (e) {
		favorited.value = prev;
		uni.showToast({ title: '网络异常，请重试', icon: 'none' });
	} finally {
		favoriting.value = false;
	}
}

/* 保存图片仅保留「大图预览长按保存」（previewImage 微信内置能力），不再提供按钮式 downloadFile+saveImageToPhotosAlbum */

/* ============ 作者主页 ============ */
function goUserHome() {
	const uid = wallpaper.value && wallpaper.value.author_id;
	if (!uid) return;
	uni.navigateTo({ url: '/pages/UserHome/user-home?uid=' + uid });
}

/* ============ 举报 ============ */
const reportVisible = ref(false);
const reportReasons = ['色情低俗', '侵权盗版', '垃圾广告', '欺诈信息', '其他'];
const reportReason = ref('色情低俗');
const reportText = ref('');
const reporting = ref(false);

function openReport() {
	if (!loginGuard()) return;
	reportReason.value = reportReasons[0];
	reportText.value = '';
	reportVisible.value = true;
}

async function submitReport() {
	if (reporting.value) return;
	const reason = reportReason.value + (reportText.value.trim() ? '：' + reportText.value.trim() : '');
	reporting.value = true;
	try {
		const res = await call('report', { reason });
		if (res.errCode !== 0) {
			uni.showToast({ title: res.errMsg || '举报失败', icon: 'none' });
			return;
		}
		reportVisible.value = false;
		uni.showToast({ title: '已提交，感谢反馈', icon: 'success' });
	} catch (e) {
		uni.showToast({ title: '网络异常，请重试', icon: 'none' });
	} finally {
		reporting.value = false;
	}
}


</script>

<style lang="scss" scoped>
	.page {
		min-height: 100vh;
		background: #f4f6f9;
	}

	/* 大图：高度按图片真实宽高比自适应（内联 style），背景兜黑 */
	.hero {
		width: 100%;
		background: #000;
		position: relative;

		.hero-img {
		display: block;
		width: 100%;
	}

	/* 左下角「长按可保存」轻提示 */
	.hero-tip {
		position: absolute;
		left: 20rpx;
		bottom: 20rpx;
		display: flex;
		align-items: center;
		padding: 8rpx 18rpx;
		border-radius: 24rpx;
		background: rgba(0, 0, 0, 0.35);

		text {
			margin-left: 6rpx;
			font-size: 22rpx;
			color: #fff;
		}
	}

	/* 分享 / 收藏 / 举报 悬浮按钮 */
	.hero-ops {
			position: absolute;
			top: 20rpx;
			right: 20rpx;
			display: flex;

			.hero-op {
				width: 64rpx;
				height: 64rpx;
				border-radius: 50%;
				background: rgba(0, 0, 0, 0.35);
				display: flex;
				align-items: center;
				justify-content: center;
				margin-left: 16rpx;
			}

			// 重置 button 默认样式
			button.hero-op {
				padding: 0;
				line-height: normal;

				&::after {
					border: none;
				}
			}
		}
	}

	/* 举报弹窗 */
	.dialog-mask {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 200;
	}

	.dialog {
		width: 600rpx;
		background: #fff;
		border-radius: 20rpx;
		padding: 32rpx;

		.dialog-title {
			font-size: 30rpx;
			font-weight: bold;
			color: #2b3a4a;
			margin-bottom: 20rpx;
		}

		.report-reasons {
			display: flex;
			flex-wrap: wrap;
			margin-bottom: 16rpx;

			.reason-chip {
				padding: 10rpx 28rpx;
				margin: 0 16rpx 16rpx 0;
				border-radius: 32rpx;
				background: #f2f5f8;
				font-size: 24rpx;
				color: #4a5868;

				&.active {
					background: #e8f3fe;
					color: #2c98e7;
				}
			}
		}

		.dialog-textarea {
			width: 100%;
			min-height: 140rpx;
			box-sizing: border-box;
			background: #f4f6f9;
			border-radius: 12rpx;
			padding: 20rpx;
			font-size: 26rpx;
		}

		.dialog-btns {
			display: flex;
			justify-content: flex-end;
			margin-top: 24rpx;

			.dialog-btn {
				padding: 12rpx 36rpx;
				border-radius: 32rpx;
				font-size: 26rpx;
				margin-left: 20rpx;

				&.cancel {
					background: #f2f5f8;
					color: #4a5868;
				}

				&.danger {
					background: #e65a5a;
					color: #fff;
				}
			}
		}
	}

	.card {
		margin: 20rpx;
		background: #fff;
		border-radius: 20rpx;
		padding: 24rpx;
		box-shadow: 0 6rpx 20rpx rgba(31, 95, 174, 0.06);
	}

	.author-card {
		margin-top: -30rpx;
		position: relative;

		.author {
			display: flex;
			align-items: center;

			.avatar {
				width: 72rpx;
				height: 72rpx;
				border-radius: 50%;
			}

			.avatar-default {
				background: #eef2f7;
				display: flex;
				align-items: center;
				justify-content: center;
			}

			.name {
				margin-left: 16rpx;
				font-size: 30rpx;
				font-weight: bold;
				color: #2b3a4a;
			}
		}

		.desc {
		margin-top: 20rpx;
		font-size: 28rpx;
		line-height: 1.6;
		color: #4a5868;
		word-break: break-all;
	}

		/* 标签 */
		.tag-row {
			display: flex;
			flex-wrap: wrap;
			margin-top: 18rpx;

			.tag-chip {
				padding: 6rpx 20rpx;
				margin-right: 14rpx;
				border-radius: 24rpx;
				background: #eef6ff;
				font-size: 24rpx;
				color: #2c98e7;
			}
		}

		/* 元信息行 */
		.meta-row {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			margin-top: 22rpx;
			padding-top: 20rpx;
			border-top: 1rpx solid #f2f5f8;

			.meta-item {
				display: flex;
				align-items: center;
				margin-right: 32rpx;

				.meta-text {
					margin-left: 8rpx;
					font-size: 24rpx;
					color: #8fa3b5;
				}
			}
		}

		/* 保存引导提示条 */
		.save-tip {
			display: flex;
			align-items: center;
			justify-content: center;
			margin-top: 24rpx;
			padding: 18rpx 0;
			border-radius: 16rpx;
			background: #f2f9ff;

			text {
				margin-left: 8rpx;
				font-size: 24rpx;
				color: #2c98e7;
			}
		}
	}

	/* 相关推荐 */
	.related-card {
		.section-title {
			font-size: 30rpx;
			font-weight: bold;
			color: #2b3a4a;
			padding-bottom: 20rpx;
		}

		.related-scroll {
			width: 100%;
			white-space: nowrap;
		}

		.related-inner {
			display: flex;
			padding-bottom: 6rpx;
		}

		.related-item {
			flex-shrink: 0;
			width: 200rpx;
			margin-right: 18rpx;

			&:last-child {
				margin-right: 0;
			}

			.related-img {
				width: 200rpx;
				height: 260rpx;
				border-radius: 14rpx;
				background: #eef2f7;
				display: block;
			}

			.related-desc {
				display: block;
				margin-top: 10rpx;
				font-size: 22rpx;
				color: #7a8794;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}
		}
	}

	.comment-card {
		.section-title {
			font-size: 30rpx;
			font-weight: bold;
			color: #2b3a4a;
			padding-bottom: 20rpx;
			border-bottom: 1rpx solid #f0f2f5;
		}

		.comment-empty {
			padding: 60rpx 0;
			text-align: center;
			font-size: 26rpx;
			color: #a7bfd3;
		}

		.comment-item {
			display: flex;
			padding: 24rpx 0;
			border-bottom: 1rpx solid #f5f7fa;

			&:last-child {
				border-bottom: none;
			}

			.c-avatar {
				width: 64rpx;
				height: 64rpx;
				border-radius: 50%;
				flex-shrink: 0;
			}

			.c-avatar-default {
				background: #eef2f7;
				display: flex;
				align-items: center;
				justify-content: center;
			}

			.c-body {
				margin-left: 16rpx;
				flex: 1;
				min-width: 0;
				display: flex;
				flex-direction: column;

				.c-name {
					font-size: 24rpx;
					color: #8a97a6;
				}

				.c-content {
					margin-top: 8rpx;
					font-size: 28rpx;
					line-height: 1.5;
					color: #2b3a4a;
					word-break: break-all;
				}

				.c-meta {
					margin-top: 10rpx;
					display: flex;
					align-items: center;

					.c-time {
						font-size: 22rpx;
						color: #b6c0cc;
					}

					.c-reply-entry {
						margin-left: 28rpx;
						font-size: 22rpx;
						color: #5a8fc2;
					}

					.c-delete-entry {
						margin-left: 28rpx;
						font-size: 22rpx;
						color: #e07a7a;
					}
				}

				/* 回复盖楼区 */
				.reply-block {
					margin-top: 14rpx;
					padding: 14rpx 18rpx;
					background: #f4f7fa;
					border-radius: 12rpx;

					.reply-item {
						font-size: 24rpx;
						line-height: 1.7;
						word-break: break-all;

						.r-name {
							color: #3a73ad;
						}

						.r-to {
							color: #8a97a6;
						}

						.r-toname {
							color: #3a73ad;
						}

						.r-colon,
						.r-content {
							color: #4a5868;
						}

						.r-time {
							font-size: 20rpx;
							color: #b6c0cc;
						}

						.r-delete {
							font-size: 20rpx;
							color: #e07a7a;
						}
					}

					.reply-more {
						margin-top: 8rpx;
						font-size: 22rpx;
						color: #3a73ad;
					}
				}
			}
		}

		.loading-tip {
			padding: 24rpx 0;
			text-align: center;
			font-size: 24rpx;
			color: #8fb6d6;
		}
	}

	.bottom-holder {
		width: 100%;
	}

	/* 底部操作栏（回复提示条 + 输入行） */
	.bottom-wrap {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		background: #fff;
		box-shadow: 0 -4rpx 16rpx rgba(31, 95, 174, 0.06);
		box-sizing: content-box;
		z-index: 100;

		.reply-chip {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 12rpx 28rpx;
			background: #eef4fb;

			.chip-text {
				font-size: 24rpx;
				color: #3a73ad;
				overflow: hidden;
				white-space: nowrap;
				text-overflow: ellipsis;
			}

			.chip-cancel {
				flex-shrink: 0;
				margin-left: 24rpx;
				font-size: 24rpx;
				color: #8a97a6;
			}
		}

		.bottom-bar {
			display: flex;
			align-items: center;
			padding: 10rpx 20rpx;

		.like-btn {
			display: flex;
			flex-direction: column;
			align-items: center;
			width: 80rpx;
			flex-shrink: 0;

			.like-num {
				margin-top: 2rpx;
				font-size: 20rpx;
				color: #7a8794;

				&.active {
					color: #ff4d5e;
				}
			}
		}

		.comment-input {
			flex: 1;
			height: 68rpx;
			margin: 0 16rpx;
			padding: 0 24rpx;
			background: #f2f5f8;
			border-radius: 34rpx;
			font-size: 26rpx;
		}

		.send-btn {
			flex-shrink: 0;
			padding: 0 28rpx;
			height: 68rpx;
			line-height: 68rpx;
			border-radius: 34rpx;
			background: linear-gradient(90deg, #4facfe 0%, #2c98e7 100%);
			color: #fff;
			font-size: 26rpx;

			&.disabled {
				opacity: 0.4;
			}
		}
		}
	}

	/* ===== 骨架屏：加载期铺在大图/信息/评论区之上，数据到达后淡出 ===== */
	.feed {
		position: relative;
	}

	/* 加载期撑住高度：骨架层绝对定位不占位，避免内容到达时页面塌陷跳动 */
	.feed-loading {
		min-height: 1100rpx;
	}

	/* 骨架层底色跟随本页页面底色，避免淡出时出现色差闪白 */
	.sk-layer {
		background: #f4f6f9;
	}

	/* 骨架形状（灰块底与斜向扫光由全局 .sk / .sk-shine 提供） */
	.sk-hero {
		width: 100%;
		height: 900rpx;
		border-radius: 0;
	}

	.sk-avatar {
		width: 80rpx;
		height: 80rpx;
		border-radius: 50%;
	}

	.sk-row {
		display: flex;
		align-items: center;
		padding: 30rpx;
		gap: 20rpx;
	}

	.sk-col {
		flex: 1;
	}

	.sk-line {
		height: 28rpx;
		width: 90%;
		border-radius: 8rpx;
		margin: 16rpx 30rpx 0;

		&.short {
			width: 55%;
		}
	}
</style>