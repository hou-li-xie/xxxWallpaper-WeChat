'use strict';
const { requireActiveUser } = require('../common/auth');
const { checkTextRisk } = require('../common/risk');
const { ALLOWED_TAGS } = require('../common/constants');

/* ========== 详情：照片数据 + 当前用户是否已赞 + 最新计数 ========== */
async function detail(ctx) {
	const { wallpaperCol, likeCol, favCol, uid, event } = ctx;
	const { id } = event;
	if (!id) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少照片ID' };
	const wpRes = await wallpaperCol.doc(id).get();
	const wallpaper = wpRes.data && wpRes.data[0];
	if (!wallpaper) {
		return { errCode: 'NOT_FOUND', errMsg: '照片不存在' };
	}
	// 未审核通过的内容仅作者本人可见
	if (wallpaper.audit_status !== 1 && wallpaper.author_id !== uid) {
		return { errCode: 'NOT_FOUND', errMsg: '照片不存在或未通过审核' };
	}

	const countRes = await likeCol.where({ wallpaper_id: id }).count();
	let liked = false;
	let favorited = false;
	if (uid) {
		const myLike = await likeCol
			.where({ wallpaper_id: id, user_id: uid })
			.limit(1)
			.get();
		liked = !!(myLike.data && myLike.data.length);
		const myFav = await favCol
			.where({ wallpaper_id: id, user_id: uid })
			.limit(1)
			.get();
		favorited = !!(myFav.data && myFav.data.length);
	}

	return {
		errCode: 0,
		wallpaper,
		liked,
		favorited,
		likeCount: countRes.total,
		viewCount: (wallpaper.info && wallpaper.info.viewNum) || 0,
		commentCount: (wallpaper.info && wallpaper.info.commentNum) || 0
	};
}

/* ========== 浏览量 +1（客户端按照片本地 10 分钟去重后调用，无需登录；仅计已过审照片） ========== */
async function recordView(ctx) {
	const { dbCmd, wallpaperCol, callerId, event } = ctx;
	const { id } = event;
	if (!id) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少照片ID' };
	if (!checkRateLimit('recordView', callerId + ':' + id)) {
		// 触发限流时返回当前浏览量（不重复 +1），避免详情页显示为 0
		const cur = await wallpaperCol.doc(id).field({ 'info.viewNum': true }).get();
		const doc = cur.data && cur.data[0];
		return { errCode: 0, viewCount: (doc && doc.info && doc.info.viewNum) || 0 };
	}
	// 先读当前值，失败时可返回旧值而非 0
	const beforeRes = await wallpaperCol.doc(id).field({ 'info.viewNum': true }).get();
	const beforeDoc = beforeRes.data && beforeRes.data[0];
	const beforeCount = (beforeDoc && beforeDoc.info && beforeDoc.info.viewNum) || 0;
	try {
		await wallpaperCol
			.where({ _id: id, audit_status: 1 })
			.update({ 'info.viewNum': dbCmd.inc(1) });
	} catch (e) {
		// 计数失败不影响浏览主流程，返回旧值
		return { errCode: 0, viewCount: beforeCount };
	}
	const after = await wallpaperCol.doc(id).field({ 'info.viewNum': true }).get();
	const doc = after.data && after.data[0];
	return { errCode: 0, viewCount: (doc && doc.info && doc.info.viewNum) || beforeCount };
}

/* ========== 发布照片（客户端先上传云存储，再调本 action 落库；封禁用户拦截） ========== */
async function publish(ctx) {
	const { userCol, wallpaperCol, uid, event } = ctx;
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录后再发布' };
	const banned = await requireActiveUser(userCol, uid);
	if (banned) return banned;

	const image = String(event.image || '').trim();
	if (!image) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少图片' };
	const desc = String(event.description || '').trim();
	if (desc.length > 100) return { errCode: 'PARAM_ILLEGAL', errMsg: '描述最多100字' };

	const tags = event.tags || [];
	// 标签白名单校验（最多 2 个，非法标签直接丢弃）
	const validTags = (Array.isArray(tags) ? tags : [])
		.map((t) => String(t))
		.filter((t) => ALLOWED_TAGS.indexOf(t) !== -1)
		.slice(0, 2);

	// 图片宽高（客户端裁剪输出回传，仅作瀑布流布局展示用，需范围校验）
	const imgW = parseInt(event.width, 10);
	const imgH = parseInt(event.height, 10);
	const dims =
		imgW > 0 && imgW <= 10000 && imgH > 0 && imgH <= 10000
			? { width: imgW, height: imgH }
			: {};

	const userRes = await userCol.doc(uid).get();
	const user = userRes.data && userRes.data[0];

	// 描述过文本安全检测；接口异常容错放行
	if (desc) {
		try {
			const safe = await checkTextRisk(user && user.wx_openid, desc);
			if (!safe.pass) {
				return { errCode: 'CONTENT_RISKY', errMsg: '描述包含违规信息，无法发布' };
			}
		} catch (e) {
			console.error('[wallpaper-action] publish msgSecCheck 异常，放行：', e);
		}
	}

	const record = {
		image,
		description: desc || '该用户什么也没留下....',
		author_id: uid,
		author: {
			name: (user && user.nickname) || '用户',
			avatar: (user && user.avatar) || ''
		},
		info: { likeNum: 0, commentNum: 0 },
		tags: validTags,
		...dims,
		createTime: Date.now(),
		audit_status: 0
	};

	const addRes = await wallpaperCol.add(record);
	return { errCode: 0, id: addRes.id };
}

/* ========== 编辑我的上传：仅可改描述，保存后重新进入待审核 ========== */
async function updateUpload(ctx) {
	const { dbCmd, userCol, wallpaperCol, uid, event } = ctx;
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
	const banned = await requireActiveUser(userCol, uid);
	if (banned) return banned;
	const { id } = event;
	if (!id) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少ID' };
	const desc = String(event.description || '').trim();
	if (desc.length > 200) return { errCode: 'PARAM_ILLEGAL', errMsg: '描述最多200字' };

	const wpRes = await wallpaperCol.doc(id).get();
	const wallpaper = wpRes.data && wpRes.data[0];
	if (!wallpaper) return { errCode: 'NOT_FOUND', errMsg: '记录不存在或已删除' };
	if (wallpaper.author_id !== uid) {
		return { errCode: 'NO_PERMISSION', errMsg: '只能编辑自己的上传' };
	}

	// 描述同样过文本安全检测，防止借编辑绕过审核
	if (desc) {
		const userRes = await userCol.doc(uid).get();
		const user = userRes.data && userRes.data[0];
		const check = await checkTextRisk(user && user.wx_openid, desc);
		if (!check.pass) {
			return { errCode: 'CONTENT_RISKY', errMsg: '内容包含违规信息，无法保存' };
		}
	}

	// 编辑后回到待审核：audit_status 归 0，清空驳回原因
	await wallpaperCol.doc(id).update({
		description: desc,
		audit_status: 0,
		audit_reason: dbCmd.remove()
	});
	return { errCode: 0, id };
}

/* ========== 删除我的上传：级联清理点赞/评论/通知，并删除云存储图片 ========== */
async function deleteUpload(ctx) {
	const { likeCol, commentCol, notiCol, favCol, wallpaperCol, userCol, uid, event } = ctx;
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
	const banned = await requireActiveUser(userCol, uid);
	if (banned) return banned;
	const { id } = event;
	if (!id) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少ID' };

	const wpRes = await wallpaperCol.doc(id).get();
	const wallpaper = wpRes.data && wpRes.data[0];
	if (!wallpaper) return { errCode: 'NOT_FOUND', errMsg: '记录不存在或已删除' };
	if (wallpaper.author_id !== uid) {
		return { errCode: 'NO_PERMISSION', errMsg: '只能删除自己的上传' };
	}

	await likeCol.where({ wallpaper_id: id }).remove();
	await commentCol.where({ wallpaper_id: id }).remove();
	await notiCol.where({ wallpaper_id: id }).remove();
	await favCol.where({ wallpaper_id: id }).remove();
	await wallpaperCol.doc(id).remove();

	// 云存储图片清理，失败不阻塞（记录已删）
	if (wallpaper.image) {
		try {
			await uniCloud.deleteFile({ fileList: [wallpaper.image] });
		} catch (e) {}
	}
	return { errCode: 0, id };
}

module.exports = { detail, recordView, publish, updateUpload, deleteUpload };
