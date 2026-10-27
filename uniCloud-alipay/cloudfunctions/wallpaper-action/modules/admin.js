'use strict';
const { requireAdmin } = require('../common/auth');
const { sendAuditSubscribe } = require('../common/wx');

/* ========== 管理员：全量照片分页列表（status: -1 全部 / 0 待审核 / 1 已通过 / 2 已驳回） ========== */
async function adminList(ctx) {
	const { wallpaperCol, userCol, uid, event } = ctx;
	const { status = -1, skip = 0 } = event;
	const deny = await requireAdmin(userCol, uid);
	if (deny) return deny;

	const LIMIT = 10;
	const st = Number(status);
	let query = wallpaperCol;
	if (st === 0 || st === 1 || st === 2) {
		query = query.where({ audit_status: st });
	}
	const listRes = await query
		.orderBy('createTime', 'desc')
		.skip(skip)
		.limit(LIMIT)
		.get();
	const list = listRes.data || [];
	return { errCode: 0, list, hasMore: list.length === LIMIT };
}

/* ========== 管理员：审核通过 ========== */
async function auditApprove(ctx) {
	const { db, dbCmd, wallpaperCol, notiCol, userCol, uid, event } = ctx;
	const { id } = event;
	const deny = await requireAdmin(userCol, uid);
	if (deny) return deny;
	if (!id) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少ID' };

	const wpRes = await wallpaperCol.doc(id).get();
	const wallpaper = wpRes.data && wpRes.data[0];
	if (!wallpaper) return { errCode: 'NOT_FOUND', errMsg: '记录不存在或已删除' };

	await wallpaperCol.doc(id).update({
		audit_status: 1,
		audit_time: Date.now(),
		audit_reason: dbCmd.remove()
	});

	// 站内通知作者审核通过（失败不影响审核主流程）
	if (wallpaper.author_id) {
		try {
			await notiCol.add({
				user_id: wallpaper.author_id,
				type: 'audit',
				wallpaper_id: id,
				wallpaper_image: wallpaper.image || '',
				from: { uid: 'system', name: '系统通知', avatar: '' },
				content: '你上传的照片已通过审核，现在公开展示啦',
				is_read: 0,
				create_time: Date.now()
			});
		} catch (e) {
			console.error('[wallpaper-action] 审核通过通知写入失败', e);
		}
		// 微信订阅消息通知（有额度才下发，静默失败）
		try {
			await sendAuditSubscribe(db, dbCmd, wallpaper.author_id, {
				description: wallpaper.description,
				passed: true
			});
		} catch (e) {
			console.error('[wallpaper-action] 审核通过订阅消息下发失败', e);
		}
	}
	return { errCode: 0, id };
}

/* ========== 管理员：审核驳回（必填原因，展示给作者） ========== */
async function auditReject(ctx) {
	const { db, dbCmd, wallpaperCol, notiCol, userCol, uid, event } = ctx;
	const { id, reason } = event;
	const deny = await requireAdmin(userCol, uid);
	if (deny) return deny;
	if (!id) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少ID' };

	const text = String(reason == null ? '' : reason).trim();
	if (!text) return { errCode: 'PARAM_ILLEGAL', errMsg: '请填写驳回原因' };
	if (text.length > 100) return { errCode: 'PARAM_ILLEGAL', errMsg: '驳回原因最多100字' };

	const wpRes = await wallpaperCol.doc(id).get();
	const wallpaper = wpRes.data && wpRes.data[0];
	if (!wallpaper) return { errCode: 'NOT_FOUND', errMsg: '记录不存在或已删除' };

	await wallpaperCol.doc(id).update({
		audit_status: 2,
		audit_reason: text,
		audit_time: Date.now()
	});

	// 站内通知作者审核驳回及原因（失败不影响审核主流程）
	if (wallpaper.author_id) {
		try {
			await notiCol.add({
				user_id: wallpaper.author_id,
				type: 'audit',
				wallpaper_id: id,
				wallpaper_image: wallpaper.image || '',
				from: { uid: 'system', name: '系统通知', avatar: '' },
				content: '你上传的照片未通过审核：' + text,
				is_read: 0,
				create_time: Date.now()
			});
		} catch (e) {
			console.error('[wallpaper-action] 审核驳回通知写入失败', e);
		}
		// 微信订阅消息通知（有额度才下发，静默失败）
		try {
			await sendAuditSubscribe(db, dbCmd, wallpaper.author_id, {
				description: wallpaper.description,
				passed: false,
				reason: text
			});
		} catch (e) {
			console.error('[wallpaper-action] 审核驳回订阅消息下发失败', e);
		}
	}
	return { errCode: 0, id };
}

/* ========== 管理员：修改任意记录的描述（不变更审核状态） ========== */
async function adminUpdate(ctx) {
	const { wallpaperCol, userCol, uid, event } = ctx;
	const { id } = event;
	const deny = await requireAdmin(userCol, uid);
	if (deny) return deny;
	if (!id) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少ID' };

	const desc = String(event.description || '').trim();
	if (desc.length > 200) return { errCode: 'PARAM_ILLEGAL', errMsg: '描述最多200字' };

	const wpRes = await wallpaperCol.doc(id).get();
	const wallpaper = wpRes.data && wpRes.data[0];
	if (!wallpaper) return { errCode: 'NOT_FOUND', errMsg: '记录不存在或已删除' };

	await wallpaperCol.doc(id).update({ description: desc });
	return { errCode: 0, id };
}

/* ========== 管理员：删除任意记录，级联清理点赞/评论/通知/云存储图片 ========== */
async function adminDelete(ctx) {
	const { likeCol, commentCol, notiCol, favCol, wallpaperCol, userCol, uid, event } = ctx;
	const { id } = event;
	const deny = await requireAdmin(userCol, uid);
	if (deny) return deny;
	if (!id) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少ID' };

	const wpRes = await wallpaperCol.doc(id).get();
	const wallpaper = wpRes.data && wpRes.data[0];
	if (!wallpaper) return { errCode: 'NOT_FOUND', errMsg: '记录不存在或已删除' };

	await likeCol.where({ wallpaper_id: id }).remove();
	await commentCol.where({ wallpaper_id: id }).remove();
	await notiCol.where({ wallpaper_id: id }).remove();
	await favCol.where({ wallpaper_id: id }).remove();
	await wallpaperCol.doc(id).remove();

	if (wallpaper.image) {
		try {
			await uniCloud.deleteFile({ fileList: [wallpaper.image] });
		} catch (e) {}
	}
	return { errCode: 0, id };
}

/* ========== 管理员：批量审核通过（ids 数组，最多 20 条/次） ========== */
async function batchApprove(ctx) {
	const { db, dbCmd, wallpaperCol, notiCol, userCol, uid, event } = ctx;
	const { ids = [] } = event;
	const deny = await requireAdmin(userCol, uid);
	if (deny) return deny;
	const idList = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean).slice(0, 20);
	if (!idList.length) return { errCode: 'PARAM_ILLEGAL', errMsg: '请选择要通过的照片' };

	const now = Date.now();
	const wpRes = await wallpaperCol.where({ _id: dbCmd.in(idList) }).get();
	const records = wpRes.data || [];
	if (!records.length) return { errCode: 'NOT_FOUND', errMsg: '所选照片不存在或已删除' };

	// 并发更新审核状态
	await Promise.all(
		records.map((wp) =>
			wallpaperCol.doc(wp._id).update({
				audit_status: 1,
				audit_time: now,
				audit_reason: dbCmd.remove()
			})
		)
	);

	// 逐个通知作者（失败不阻塞，仅记日志）
	await Promise.all(
		records
			.filter((wp) => wp.author_id)
			.map((wp) =>
				Promise.all([
					notiCol
						.add({
							user_id: wp.author_id,
							type: 'audit',
							wallpaper_id: wp._id,
							wallpaper_image: wp.image || '',
							from: { uid: 'system', name: '系统通知', avatar: '' },
							content: '你上传的照片已通过审核，现在公开展示啦',
							is_read: 0,
							create_time: now
						})
						.catch((e) => console.error('[wallpaper-action] 批量通过通知写入失败', e)),
					sendAuditSubscribe(db, dbCmd, wp.author_id, {
						description: wp.description,
						passed: true
					}).catch((e) => console.error('[wallpaper-action] 批量通过订阅消息下发失败', e))
				])
			)
	);

	return { errCode: 0, approved: records.length };
}

/* ========== 管理员：数据概览统计（审核分布 + 互动 + 用户 + 待处理举报） ========== */
async function adminStats(ctx) {
	const { wallpaperCol, commentCol, likeCol, reportCol, userCol, uid } = ctx;
	const deny = await requireAdmin(userCol, uid);
	if (deny) return deny;

	const [total, pending, approved, rejected, userCount, commentCount, likeCount, reportPending] =
		await Promise.all([
			wallpaperCol.count(),
			wallpaperCol.where({ audit_status: 0 }).count(),
			wallpaperCol.where({ audit_status: 1 }).count(),
			wallpaperCol.where({ audit_status: 2 }).count(),
			userCol.count(),
			commentCol.count(),
			likeCol.count(),
			reportCol.where({ status: 0 }).count()
		]);

	return {
		errCode: 0,
		stats: {
			total: total.total || 0,
			pending: pending.total || 0,
			approved: approved.total || 0,
			rejected: rejected.total || 0,
			users: userCount.total || 0,
			comments: commentCount.total || 0,
			likes: likeCount.total || 0,
			reportsPending: reportPending.total || 0
		}
	};
}

/* ========== 管理员：举报列表（status: -1 全部 / 0 待处理 / 1 已处理 / 2 已忽略） ========== */
async function adminReports(ctx) {
	const { dbCmd, wallpaperCol, reportCol, userCol, uid, event } = ctx;
	const { status = -1, skip = 0 } = event;
	const deny = await requireAdmin(userCol, uid);
	if (deny) return deny;

	const LIMIT = 10;
	const st = Number(status);
	let query = reportCol;
	if (st === 0 || st === 1 || st === 2) {
		query = query.where({ status: st });
	}
	const listRes = await query
		.orderBy('create_time', 'desc')
		.skip(skip)
		.limit(LIMIT)
		.get();
	const list = listRes.data || [];
	if (!list.length) return { errCode: 0, list: [], hasMore: false };

	// 批量回填被举报照片与举报人昵称
	const wpIds = [...new Set(list.map((r) => r.wallpaper_id))];
	const reporterIds = [...new Set(list.map((r) => r.reporter_id))];
	const wpRes = await wallpaperCol.where({ _id: dbCmd.in(wpIds) }).get();
	const wpMap = {};
	(wpRes.data || []).forEach((wp) => {
		wpMap[wp._id] = {
			image: wp.image || '',
			description: wp.description || '',
			audit_status: wp.audit_status ?? 0,
			author: wp.author || null
		};
	});
	const uRes = await userCol.where({ _id: dbCmd.in(reporterIds) }).field({ nickname: 1 }).get();
	const uMap = {};
	(uRes.data || []).forEach((u) => {
		uMap[u._id] = u.nickname || '用户';
	});

	const mapped = list.map((r) => ({
		...r,
		wallpaper: wpMap[r.wallpaper_id] || null, // null 表示照片已被删除
		reporter_name: uMap[r.reporter_id] || '用户'
	}));
	return { errCode: 0, list: mapped, hasMore: list.length === LIMIT };
}

/* ========== 管理员：处理举报（delete=删除照片 / ignore=忽略） ========== */
async function handleReport(ctx) {
	const { likeCol, commentCol, notiCol, favCol, wallpaperCol, reportCol, userCol, uid, event } = ctx;
	const { id, reason, handleResult = '' } = event;
	const deny = await requireAdmin(userCol, uid);
	if (deny) return deny;
	if (!id) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少举报ID' };

	const rpRes = await reportCol.doc(id).get();
	const report = rpRes.data && rpRes.data[0];
	if (!report) return { errCode: 'NOT_FOUND', errMsg: '举报不存在或已处理' };

	const now = Date.now();
	const text = String(reason == null ? '' : reason).trim();
	if (text.length > 100) return { errCode: 'PARAM_ILLEGAL', errMsg: '处理备注最多100字' };
	const note = text || (handleResult === 'delete' ? '违规，已删除照片' : '举报不成立，已忽略');

	if (handleResult === 'delete') {
		const wpRes = await wallpaperCol.doc(report.wallpaper_id).get();
		const wallpaper = wpRes.data && wpRes.data[0];
		if (wallpaper) {
			// 级联删除：点赞/评论/通知/收藏/云存储图片，并通知作者
			await likeCol.where({ wallpaper_id: wallpaper._id }).remove();
			await commentCol.where({ wallpaper_id: wallpaper._id }).remove();
			await notiCol.where({ wallpaper_id: wallpaper._id }).remove();
			await favCol.where({ wallpaper_id: wallpaper._id }).remove();
			await wallpaperCol.doc(wallpaper._id).remove();
			if (wallpaper.image) {
				try {
					await uniCloud.deleteFile({ fileList: [wallpaper.image] });
				} catch (e) {}
			}
			if (wallpaper.author_id) {
				try {
					await notiCol.add({
						user_id: wallpaper.author_id,
						type: 'audit',
						wallpaper_id: '',
						wallpaper_image: '',
						from: { uid: 'system', name: '系统通知', avatar: '' },
						content: '你上传的照片因被举报核实违规，已被删除：' + note,
						is_read: 0,
						create_time: now
					});
				} catch (e) {
					console.error('[wallpaper-action] 举报删除通知写入失败', e);
				}
			}
		}
		// 该照片的全部举报一并结案
		await reportCol
			.where({ wallpaper_id: report.wallpaper_id, status: 0 })
			.update({ status: 1, handle_note: note, handle_time: now });
	} else {
		// 仅忽略当前这条举报，照片不受影响
		await reportCol.doc(id).update({ status: 2, handle_note: note, handle_time: now });
	}
	return { errCode: 0, id };
}

/* ========== 管理员：全量评论分页（含回复，回填所属照片图） ========== */
async function adminComments(ctx) {
	const { dbCmd, wallpaperCol, commentCol, userCol, uid, event } = ctx;
	const { skip = 0 } = event;
	const deny = await requireAdmin(userCol, uid);
	if (deny) return deny;

	const LIMIT = 20;
	const listRes = await commentCol
		.orderBy('create_time', 'desc')
		.skip(skip)
		.limit(LIMIT)
		.get();
	const list = listRes.data || [];
	if (!list.length) return { errCode: 0, list: [], hasMore: false };

	const wpIds = [...new Set(list.map((c) => c.wallpaper_id))];
	const wpRes = await wallpaperCol.where({ _id: dbCmd.in(wpIds) }).get();
	const wpMap = {};
	(wpRes.data || []).forEach((wp) => {
		wpMap[wp._id] = wp.image || '';
	});
	const mapped = list.map((c) => ({
		...c,
		_wallpaperImage: wpMap[c.wallpaper_id] || ''
	}));
	return { errCode: 0, list: mapped, hasMore: list.length === LIMIT };
}

/* ========== 管理员：删除任意评论（顶级评论级联删回复，计数/通知同步回滚） ========== */
async function adminDeleteComment(ctx) {
	const { dbCmd, wallpaperCol, commentCol, notiCol, userCol, uid, event } = ctx;
	const { commentId } = event;
	const deny = await requireAdmin(userCol, uid);
	if (deny) return deny;
	if (!commentId) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少评论ID' };

	const cRes = await commentCol.doc(commentId).get();
	const comment = cRes.data && cRes.data[0];
	if (!comment) return { errCode: 'NOT_FOUND', errMsg: '评论不存在或已删除' };

	if (comment.parent_id) {
		await commentCol.doc(commentId).remove();
		await wallpaperCol
			.doc(comment.wallpaper_id)
			.update({ 'info.commentNum': dbCmd.inc(-1) });
		await notiCol.where({ reply_id: commentId }).remove();
	} else {
		const replyCountRes = await commentCol.where({ parent_id: commentId }).count();
		const replyNum = replyCountRes.total || 0;
		await commentCol.where({ parent_id: commentId }).remove();
		await commentCol.doc(commentId).remove();
		await wallpaperCol
			.doc(comment.wallpaper_id)
			.update({ 'info.commentNum': dbCmd.inc(-(replyNum + 1)) });
		await notiCol.where({ parent_id: commentId }).remove();
	}
	return { errCode: 0, id: commentId };
}

/* ========== 管理员：用户分页列表（可选昵称模糊搜索，最多取 50 条/次） ========== */
async function adminUsers(ctx) {
	const { userCol, uid, event } = ctx;
	const { keyword, skip = 0 } = event;
	const deny = await requireAdmin(userCol, uid);
	if (deny) return deny;

	const kw = String(keyword == null ? '' : keyword).trim();
	let query = userCol;
	if (kw) {
		query = query.where({ nickname: new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
	}
	const listRes = await query
		.orderBy('register_date', 'desc')
		.skip(skip)
		.limit(20)
		.field({ nickname: 1, avatar: 1, status: 1, is_admin: 1, register_date: 1 })
		.get();
	const list = (listRes.data || []).map((u) => ({
		...u,
		status: u.status || 0,
		is_admin: u.is_admin || 0
	}));
	return { errCode: 0, list, hasMore: list.length === 20 };
}

/* ========== 管理员：封禁 / 解封用户（复用 uni-id-users.status，不可操作其他管理员） ========== */
async function setUserStatus(ctx) {
	const { userCol, uid, event } = ctx;
	const { targetUid, status = -1 } = event;
	const deny = await requireAdmin(userCol, uid);
	if (deny) return deny;
	if (!targetUid) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少用户ID' };

	const st = Number(status) === 1 ? 1 : 0;
	const uRes = await userCol.doc(targetUid).get();
	const target = uRes.data && uRes.data[0];
	if (!target) return { errCode: 'NOT_FOUND', errMsg: '用户不存在' };
	if (target.is_admin === 1) {
		return { errCode: 'NO_PERMISSION', errMsg: '不能对其他管理员执行此操作' };
	}

	await userCol.doc(targetUid).update({ status: st });
	return { errCode: 0, uid: targetUid, status: st };
}

module.exports = {
	adminList, auditApprove, auditReject, adminUpdate, adminDelete, batchApprove,
	adminStats, adminReports, handleReport, adminComments, adminDeleteComment,
	adminUsers, setUserStatus
};
