'use strict';
const { checkRateLimit } = require('../common/rate-limit');
const { ALLOWED_TAGS } = require('../common/constants');

// 给照片列表批量标注当前用户是否已点赞（一次 in 查询，未登录全部 false）
async function attachLiked(likeCol, dbCmd, uid, list) {
	if (!uid || !list.length) return list;
	const ids = list.map((w) => w._id);
	const likeRes = await likeCol
		.where({ wallpaper_id: dbCmd.in(ids), user_id: uid })
		.get();
	const likedSet = {};
	(likeRes.data || []).forEach((l) => {
		likedSet[l.wallpaper_id] = true;
	});
	list.forEach((w) => {
		w.liked = !!likedSet[w._id];
	});
	return list;
}

/* ========== 相关推荐：同标签已过审照片（无标签则取最新），排除自己，最多 12 条 ========== */
async function related(ctx) {
	const { dbCmd, wallpaperCol, event } = ctx;
	const { id } = event;
	if (!id) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少照片ID' };
	const curRes = await wallpaperCol.doc(id).field({ tags: true }).get();
	const cur = curRes.data && curRes.data[0];
	const tagsArr = (cur && Array.isArray(cur.tags) && cur.tags) || [];
	const LIMIT = 12;

	let list = [];
	if (tagsArr.length) {
		const relRes = await wallpaperCol
			.where({
				audit_status: 1,
				_id: dbCmd.neq(id),
				tags: dbCmd.in(tagsArr)
			})
			.orderBy('info.likeNum', 'desc')
			.limit(LIMIT)
			.get();
		list = relRes.data || [];
	}
	// 标签命中不足（或无标签）时用最新照片补齐
	if (list.length < LIMIT) {
		const excludeIds = [id].concat(list.map((r) => r._id));
		const moreRes = await wallpaperCol
			.where({
				audit_status: 1,
				_id: dbCmd.nin(excludeIds)
			})
			.orderBy('createTime', 'desc')
			.limit(LIMIT - list.length)
			.get();
		list = list.concat(moreRes.data || []);
	}
	return { errCode: 0, list };
}

/* ========== 搜索：按描述关键词模糊匹配已审核照片（正则转义防注入） ========== */
async function search(ctx) {
	const { dbCmd, wallpaperCol, likeCol, uid, callerId, event } = ctx;
	const { keyword, skip = 0 } = event;
	const kw = String(keyword == null ? '' : keyword).trim();
	if (!kw) return { errCode: 'PARAM_ILLEGAL', errMsg: '请输入搜索关键词' };
	if (kw.length > 30) return { errCode: 'PARAM_ILLEGAL', errMsg: '关键词最多30字' };
	if (!checkRateLimit('search', callerId)) {
		return { errCode: 'RATE_LIMITED', errMsg: '搜索过于频繁，请稍后再试' };
	}

	const LIMIT = 20;
	const reg = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
	const listRes = await wallpaperCol
		.where({ audit_status: 1, description: reg })
		.orderBy('createTime', 'desc')
		.skip(skip)
		.limit(LIMIT)
		.get();
	const list = listRes.data || [];
	await attachLiked(likeCol, dbCmd, uid, list);
	return { errCode: 0, list, hasMore: list.length === LIMIT };
}

/* ========== 用户联想搜索：按昵称模糊匹配，返回候选列表（最多 8 个，仅暴露 uid/昵称/头像） ========== */
async function searchUsers(ctx) {
	const { userCol, callerId, event } = ctx;
	const { keyword } = event;
	const kw = String(keyword == null ? '' : keyword).trim();
	if (!kw) return { errCode: 0, list: [] };
	if (kw.length > 20) return { errCode: 'PARAM_ILLEGAL', errMsg: '昵称最多20字' };
	if (!checkRateLimit('searchUsers', callerId)) {
		return { errCode: 0, list: [] };
	}
	const reg = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
	const uRes = await userCol
		.where({ nickname: reg })
		.field({ nickname: true, avatar: true })
		.limit(8)
		.get();
	return { errCode: 0, list: uRes.data || [] };
}

/* ========== 排行榜：按点赞/评论/浏览数取 Top20（rankType=like|comment|view） ========== */
async function ranking(ctx) {
	const { wallpaperCol, event } = ctx;
	const { rankType } = event;
	const field = rankType === 'comment' ? 'info.commentNum' : (rankType === 'view' ? 'info.viewNum' : 'info.likeNum');
	const listRes = await wallpaperCol
		.where({ audit_status: 1 })
		.orderBy(field, 'desc')
		.orderBy('createTime', 'desc')
		.limit(20)
		.get();
	return { errCode: 0, list: listRes.data || [] };
}

/* ========== 首页信息流：排序（new/hot/random）+ 组合筛选（标签/日期/作者昵称） ==========
 * sortBy=new    最新（createTime 倒序，skip 分页）
 * sortBy=hot    最热（likeNum 倒序，skip 分页）
 * sortBy=random 随机（aggregate $sample 每次取一屏；客户端回传 excludeIds 排除已见，防重复）
 * 筛选：tags 多选（白名单内）、filterTag 单选、dateFrom 起、authorKeyword 昵称模糊（正则转义）
 */
async function feed(ctx) {
	const { dbCmd, wallpaperCol, likeCol, userCol, uid, event } = ctx;
	const {
		skip = 0,
		tags = [],
		sortBy = '',
		filterTag = '',
		authorId = '',
		authorKeyword = '',
		dateFrom = 0,
		dateTo = 0,
		excludeIds = []
	} = event;
	const LIMIT = 20;
	const order = sortBy === 'hot' ? 'hot' : (sortBy === 'random' ? 'random' : 'new');

	// 标签：filterTag（顶部单选）与 tags（面板多选）合并去重，且必须在白名单内
	const tagSet = [];
	if (filterTag && ALLOWED_TAGS.indexOf(filterTag) !== -1) tagSet.push(filterTag);
	if (Array.isArray(tags)) {
		tags.forEach((t) => {
			if (ALLOWED_TAGS.indexOf(t) !== -1 && tagSet.indexOf(t) === -1) tagSet.push(t);
		});
	}

	const where = { audit_status: 1 };
	if (tagSet.length) where.tags = dbCmd.in(tagSet);
	if (authorId) where.author_id = authorId;
	// uniCloud timestamp 类型底层存 int64 毫秒数字，日期比较必须传数字（传 Date 对象类型不匹配，条件会失效）
	if (dateFrom > 0) where.createTime = dbCmd.gte(Number(dateFrom));
	if (dateTo > dateFrom && dateTo > 0) {
		where.createTime = where.createTime
			? where.createTime.and(dbCmd.lte(Number(dateTo)))
			: dbCmd.lte(Number(dateTo));
	}

	// 作者昵称模糊筛选：先解析出 uid 集合，无匹配直接返回空（authorId 精确筛选优先，跳过昵称解析）
	const ak = String(authorKeyword == null ? '' : authorKeyword).trim();
	let keywordUids = [];
	if (ak && !authorId) {
		if (ak.length > 20) return { errCode: 'PARAM_ILLEGAL', errMsg: '昵称最多20字' };
		const reg = new RegExp(ak.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
		const uRes = await userCol.where({ nickname: reg }).limit(50).get();
		keywordUids = (uRes.data || []).map((u) => u._id);
		if (!keywordUids.length) return { errCode: 0, list: [], hasMore: false };
		where.author_id = dbCmd.in(keywordUids);
	}

	if (order === 'random') {
		// aggregate match 用原生 Mongo 语法（dbCmd 命令对象不可复用）
		const match = { audit_status: 1 };
		if (tagSet.length) match.tags = { $in: tagSet };
		if (authorId) match.author_id = authorId;
		else if (keywordUids.length) match.author_id = { $in: keywordUids };
		if (dateFrom > 0) match.createTime = { $gte: Number(dateFrom) };
		if (dateTo > dateFrom && dateTo > 0) match.createTime = { ...match.createTime, $lte: Number(dateTo) };
		if (Array.isArray(excludeIds) && excludeIds.length) {
			match._id = { $nin: excludeIds.slice(0, 300) };
		}
		const aggRes = await wallpaperCol
			.aggregate()
			.match(match)
			.sample({ size: LIMIT })
			.end();
		const list = aggRes.data || [];
		await attachLiked(likeCol, dbCmd, uid, list);
		return { errCode: 0, list, hasMore: list.length === LIMIT };
	}

	let query = wallpaperCol.where(where);
	if (order === 'hot') query = query.orderBy('info.likeNum', 'desc');
	const listRes = await query.orderBy('createTime', 'desc').skip(skip).limit(LIMIT).get();
	const list = listRes.data || [];
	await attachLiked(likeCol, dbCmd, uid, list);
	return { errCode: 0, list, hasMore: list.length === LIMIT };
}

module.exports = { feed, search, searchUsers, ranking, related };
