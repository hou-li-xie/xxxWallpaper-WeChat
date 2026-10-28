'use strict';
const { requireActiveUser } = require('../common/auth');
const { checkTextRisk } = require('../common/risk');
const { sendReplySubscribe } = require('../common/wx');

/* ========== 点赞 / 取消点赞（切换） ========== */
async function toggleLike(ctx) {
	const { dbCmd, wallpaperCol, likeCol, notiCol, userCol, uid, event } = ctx;
	const { id } = event;
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
	const banned = await requireActiveUser(userCol, uid);
	if (banned) return banned;
	if (!id) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少照片ID' };

	const wpRes = await wallpaperCol.doc(id).get();
	const wallpaper = wpRes.data && wpRes.data[0];
	if (!wallpaper || wallpaper.audit_status !== 1) {
		return { errCode: 'NOT_FOUND', errMsg: '照片不存在或未通过审核' };
	}

	const existed = await likeCol
		.where({ wallpaper_id: id, user_id: uid })
		.limit(1)
		.get();

	let liked;
	if (existed.data && existed.data.length) {
		await likeCol.doc(existed.data[0]._id).remove();
		await wallpaperCol.doc(id).update({ 'info.likeNum': dbCmd.inc(-1) });
		liked = false;
	} else {
		await likeCol.add({
			wallpaper_id: id,
			user_id: uid,
			create_time: Date.now()
		});
		await wallpaperCol.doc(id).update({ 'info.likeNum': dbCmd.inc(1) });
		liked = true;

		// 点赞通知作者（自己赞自己不通知；同一用户同一内容只发一次，防止取消再赞刷通知）
		if (wallpaper.author_id && wallpaper.author_id !== uid) {
			try {
				const dup = await notiCol
					.where({
						user_id: wallpaper.author_id,
						type: 'like',
						wallpaper_id: id,
						'from.uid': uid
					})
					.count();
				if (!dup.total) {
					const uRes = await userCol.doc(uid).get();
					const u = uRes.data && uRes.data[0];
					await notiCol.add({
						user_id: wallpaper.author_id,
						type: 'like',
						wallpaper_id: id,
						wallpaper_image: wallpaper.image || '',
						from: {
							uid,
							name: (u && u.nickname) || '用户',
							avatar: (u && u.avatar) || ''
						},
						content: '',
						is_read: 0,
						create_time: Date.now()
					});
				}
			} catch (e) {
				// 通知失败不影响点赞主流程
				console.error('[wallpaper-action] 点赞通知写入失败', e);
			}
		}
	}

	const countRes = await likeCol.where({ wallpaper_id: id }).count();
	return { errCode: 0, liked, likeCount: countRes.total };
}

/* ========== 评论列表（顶级评论分页，回复按时间正序挂 replies） ========== */
async function comments(ctx) {
	const { dbCmd, commentCol, event } = ctx;
	const { id, skip = 0 } = event;
	if (!id) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少照片ID' };
	const LIMIT = 20;
	// parent_id: null 同时匹配“字段为 null”和“历史数据无该字段”的顶级评论
	const listRes = await commentCol
		.where({ wallpaper_id: id, parent_id: null })
		.orderBy('create_time', 'desc')
		.skip(skip)
		.limit(LIMIT)
		.get();
	const topList = listRes.data || [];

	// 再用一次 in 查询批量取回这批顶级评论的全部回复，避免 N+1
	let repliesAll = [];
	if (topList.length) {
		const parentIds = topList.map((c) => c._id);
		const replyRes = await commentCol
			.where({ wallpaper_id: id, parent_id: dbCmd.in(parentIds) })
			.orderBy('create_time', 'asc')
			.get();
		repliesAll = replyRes.data || [];
	}
	const replyGroup = {};
	repliesAll.forEach((r) => {
		if (!replyGroup[r.parent_id]) replyGroup[r.parent_id] = [];
		replyGroup[r.parent_id].push(r);
	});
	topList.forEach((c) => {
		c.replies = replyGroup[c._id] || [];
	});

	return { errCode: 0, list: topList, hasMore: topList.length === LIMIT };
}

/* ========== 发表评论 / 回复 ========== */
async function addComment(ctx) {
	const { db, dbCmd, wallpaperCol, commentCol, notiCol, userCol, uid, event } = ctx;
	const { id, content, parentId = '', replyId = '' } = event;
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录后再评论' };
	const banned = await requireActiveUser(userCol, uid);
	if (banned) return banned;
	if (!id) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少照片ID' };

	const text = String(content == null ? '' : content).trim();
	if (!text) return { errCode: 'CONTENT_EMPTY', errMsg: '评论内容不能为空' };
	if (text.length > 100) return { errCode: 'CONTENT_TOO_LONG', errMsg: '评论最多100字' };

	const wpRes = await wallpaperCol.doc(id).get();
	const wallpaper = wpRes.data && wpRes.data[0];
	if (!wallpaper || wallpaper.audit_status !== 1) {
		return { errCode: 'NOT_FOUND', errMsg: '照片不存在或未通过审核' };
	}

	// 回复场景：parentId 必为同照片下的顶级评论；replyId 必挂在该顶级评论下。
	// reply_to 的 uid/name 一律以库中记录为准在服务端解析，不信任客户端传值。
	let parent_id = null;
	let reply_to = null;
	if (parentId) {
		const pRes = await commentCol.where({ _id: String(parentId) }).limit(1).get();
		const parent = pRes.data && pRes.data[0];
		if (!parent || parent.wallpaper_id !== id || parent.parent_id) {
			return { errCode: 'PARENT_NOT_FOUND', errMsg: '回复的评论不存在' };
		}
		parent_id = parent._id;

		if (replyId) {
			const rRes = await commentCol.where({ _id: String(replyId) }).limit(1).get();
			const target = rRes.data && rRes.data[0];
			if (!target || target.wallpaper_id !== id || target.parent_id !== parent_id) {
				return { errCode: 'REPLY_TARGET_INVALID', errMsg: '回复目标不存在' };
			}
			reply_to = {
				uid: target.user_id,
				name: (target.author && target.author.name) || '用户'
			};
		} else {
			reply_to = {
				uid: parent.user_id,
				name: (parent.author && parent.author.name) || '用户'
			};
		}
	}

	// 取评论者最新昵称头像做快照
	const userRes = await userCol.doc(uid).get();
	const user = userRes.data && userRes.data[0];
	const authorName = (user && user.nickname) || '用户';
	const authorAvatar = (user && user.avatar) || '';

	// 微信文本内容安全检测（UGC 合规）：risky/review 一律拒绝；接口异常容错放行，避免微信侧抖动阻断评论
	try {
		const safe = await checkTextRisk(user && user.wx_openid, text);
		if (!safe.pass) {
			return { errCode: 'CONTENT_RISKY', errMsg: '内容包含违规信息，无法发布' };
		}
	} catch (e) {
		console.error('[wallpaper-action] msgSecCheck 异常，放行：', e);
	}

	const now = Date.now();
	const record = {
		wallpaper_id: id,
		user_id: uid,
		author: { name: authorName, avatar: authorAvatar },
		content: text,
		create_time: now
	};
	if (parent_id) {
		record.parent_id = parent_id;
		record.reply_to = reply_to;
	}
	const addRes = await commentCol.add(record);
	await wallpaperCol.doc(id).update({ 'info.commentNum': dbCmd.inc(1) });

	// 顶级评论：通知照片作者（自己评论自己不通知）
	if (!parent_id && wallpaper.author_id && wallpaper.author_id !== uid) {
		const noti = {
			user_id: wallpaper.author_id,
			type: 'comment',
			wallpaper_id: id,
			wallpaper_image: wallpaper.image || '',
			from: { uid, name: authorName, avatar: authorAvatar },
			reply_id: addRes.id,
			content: text,
			is_read: 0,
			create_time: now
		};
		try {
			await notiCol.add(noti);
		} catch (e) {
			console.error('[wallpaper-action] 评论通知写入失败', e);
		}
	}

	// 回复他人时写站内通知（自己回复自己不通知），并尝试下发微信订阅消息
	if (parent_id && reply_to && reply_to.uid && reply_to.uid !== uid) {
		const noti = {
			user_id: reply_to.uid,
			type: 'reply',
			wallpaper_id: id,
			wallpaper_image: wallpaper.image || '',
			from: { uid, name: authorName, avatar: authorAvatar },
			reply_id: addRes.id,
			parent_id,
			content: text,
			is_read: 0,
			create_time: now
		};
		try {
			await notiCol.add(noti);
		} catch (e) {
			// 通知落库失败不影响回复主流程
			console.error('[wallpaper-action] 通知写入失败', e);
		}
		try {
			await sendReplySubscribe(db, dbCmd, noti);
		} catch (e) {
			console.error('[wallpaper-action] 订阅消息下发失败', e);
		}
	}

	return { errCode: 0, comment: Object.assign({ _id: addRes.id }, record) };
}

/* ========== 删除自己的评论 / 回复 ========== */
async function deleteComment(ctx) {
	const { dbCmd, wallpaperCol, commentCol, notiCol, uid, event } = ctx;
	const { commentId } = event;
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
	if (!commentId) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少评论ID' };
	const cRes = await commentCol.doc(commentId).get();
	const comment = cRes.data && cRes.data[0];
	if (!comment) return { errCode: 'NOT_FOUND', errMsg: '评论不存在或已删除' };
	if (comment.user_id !== uid) {
		return { errCode: 'NO_PERMISSION', errMsg: '只能删除自己的评论' };
	}

	if (comment.parent_id) {
		// 回复：仅删自身，计数 -1，删除对应通知
		await commentCol.doc(commentId).remove();
		await wallpaperCol
			.doc(comment.wallpaper_id)
			.update({ 'info.commentNum': dbCmd.inc(-1) });
		await notiCol.where({ reply_id: commentId }).remove();
		return { errCode: 0, id: commentId, parentId: comment.parent_id, removedReplies: 0 };
	}

	// 顶级评论：级联删除其下全部回复，计数 -(1+回复数)，清理该楼下全部通知
	const replyCountRes = await commentCol.where({ parent_id: commentId }).count();
	const replyNum = replyCountRes.total || 0;
	await commentCol.where({ parent_id: commentId }).remove();
	await commentCol.doc(commentId).remove();
	await wallpaperCol
		.doc(comment.wallpaper_id)
		.update({ 'info.commentNum': dbCmd.inc(-(replyNum + 1)) });
	await notiCol.where({ parent_id: commentId }).remove();

	return { errCode: 0, id: commentId, parentId: '', removedReplies: replyNum };
}

/* ========== 收藏 / 取消收藏（切换） ========== */
async function toggleFavorite(ctx) {
	const { wallpaperCol, favCol, userCol, uid, event } = ctx;
	const { id } = event;
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
	const banned = await requireActiveUser(userCol, uid);
	if (banned) return banned;
	if (!id) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少照片ID' };

	const wpRes = await wallpaperCol.doc(id).get();
	const wallpaper = wpRes.data && wpRes.data[0];
	if (!wallpaper || wallpaper.audit_status !== 1) {
		return { errCode: 'NOT_FOUND', errMsg: '照片不存在或未通过审核' };
	}

	const existed = await favCol
		.where({ wallpaper_id: id, user_id: uid })
		.limit(1)
		.get();
	let favorited;
	if (existed.data && existed.data.length) {
		await favCol.doc(existed.data[0]._id).remove();
		favorited = false;
	} else {
		await favCol.add({ wallpaper_id: id, user_id: uid, create_time: Date.now() });
		favorited = true;
	}
	return { errCode: 0, favorited };
}

/* ========== 我的收藏列表（回填照片，过滤已删除/未过审） ========== */
async function favoriteList(ctx) {
	const { dbCmd, wallpaperCol, favCol, uid, event } = ctx;
	const { skip = 0 } = event;
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
	const LIMIT = 20;
	const favRes = await favCol
		.where({ user_id: uid })
		.orderBy('create_time', 'desc')
		.skip(skip)
		.limit(LIMIT)
		.get();
	const favs = favRes.data || [];
	if (!favs.length) return { errCode: 0, list: [], hasMore: false };

	const wpIds = favs.map((f) => f.wallpaper_id);
	const wpRes = await wallpaperCol.where({ _id: dbCmd.in(wpIds) }).get();
	const wpMap = {};
	(wpRes.data || []).forEach((wp) => {
		wpMap[wp._id] = wp;
	});
	// 保持收藏时间序，剔除照片已删除或已被下架的
	const list = favs
		.map((f) => {
			const wp = wpMap[f.wallpaper_id];
			if (!wp || wp.audit_status !== 1) return null;
			return { ...wp, _favId: f._id, _favTime: f.create_time };
		})
		.filter(Boolean);
	return { errCode: 0, list, hasMore: favs.length === LIMIT };
}

/* ========== 我的点赞列表（同 favoriteList 模式，查 wallpaper_likes 回填照片） ========== */
async function likeList(ctx) {
	const { dbCmd, wallpaperCol, likeCol, uid, event } = ctx;
	const { skip = 0 } = event;
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
	const LIMIT = 20;
	const likeRes = await likeCol
		.where({ user_id: uid })
		.orderBy('create_time', 'desc')
		.skip(skip)
		.limit(LIMIT)
		.get();
	const likes = likeRes.data || [];
	if (!likes.length) return { errCode: 0, list: [], hasMore: false };

	const wpIds = likes.map((l) => l.wallpaper_id);
	const wpRes = await wallpaperCol.where({ _id: dbCmd.in(wpIds) }).get();
	const wpMap = {};
	(wpRes.data || []).forEach((wp) => {
		wpMap[wp._id] = wp;
	});
	// 保持点赞时间序，剔除照片已删除或已被下架的
	const list = likes
		.map((l) => {
			const wp = wpMap[l.wallpaper_id];
			if (!wp || wp.audit_status !== 1) return null;
			return { ...wp, _likeId: l._id, _likeTime: l.create_time };
		})
		.filter(Boolean);
	return { errCode: 0, list, hasMore: likes.length === LIMIT };
}

module.exports = { toggleLike, comments, addComment, deleteComment, toggleFavorite, favoriteList, likeList };
