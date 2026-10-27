'use strict';
const uniIdCommon = require('uni-id-common');
const createConfig = require('uni-config-center');

/**
 * 照片互动云函数
 *
 * action 一览：
 *   detail        照片详情 + 点赞态 + 计数
 *   recordView    浏览量 +1（客户端本地 10 分钟去重）
 *   related       相关推荐（同标签已过审照片，不足补最新，最多 12 条）
 *   toggleLike    点赞 / 取消点赞
 *   comments      顶级评论分页 + 回复盖楼
 *   addComment    发表评论 / 回复（回复会写站内通知并尝试下发微信订阅消息）
 *   deleteComment 删除自己的评论（顶级评论级联删除回复）
 *   notifications 我的站内通知列表
 *   unreadCount   我的未读通知数
 *   markRead      标记单条通知已读
 *   markAllRead   全部已读
 *   saveSubscribe 微信一次性订阅授权后增加下发额度
 *   publish       发布照片落库（图片由客户端先传云存储；封禁用户拦截；tags 白名单最多2个）
 *   report        用户举报照片（同一人对同一照片仅1条待处理）
 *   search        按描述关键词搜索已审核照片（keyword + skip 分页）
 *   feed          首页信息流：sortBy=new|hot|random（随机用 aggregate $sample，客户端回传 excludeIds 去重）
 *                 组合筛选：tags/filterTag 标签、dateFrom/dateTo 日期（BSON timestamp，须传 Date）、authorKeyword 昵称模糊
 *   ranking       排行榜 Top20（rankType=like 点赞榜 / view 浏览榜 / comment 评论榜）
 *   toggleFavorite 收藏/取消收藏；favoriteList 我的收藏分页
 *   userHome      用户主页（targetUid → 用户信息 + 已过审照片分页 + photoCount）
 *
 * 管理员 action（均需 uni-id-users.is_admin === 1，is_admin 只能在 uniCloud 控制台手动设置）：
 *   adminList    全量照片分页列表（status 筛选审核状态，-1 全部）
 *   auditApprove 审核通过
 *   auditReject  审核驳回（必填驳回原因）
 *   adminUpdate  管理员修改描述（不变更审核状态）
 *   adminDelete  管理员删除任意照片（级联清理点赞/评论/通知/云存储文件）
 *   batchApprove 批量审核通过（ids 数组，最多 20 条/次）
 *   adminStats   数据概览（审核分布/互动/用户/待处理举报计数）
 *   adminReports 举报分页列表（status -1 全部 / 0 待处理 / 1 已处理 / 2 已忽略）
 *   handleReport 处理举报（handleResult=delete 级联删除照片并结案 / ignore 忽略）
 *   adminComments    全量评论分页（含回复，回填所属照片图）
 *   adminDeleteComment 删除任意评论（顶级评论级联删回复）
 *   adminUsers     用户分页列表（keyword 昵称模糊搜索）
 *   setUserStatus 封禁/解封用户（复用 uni-id-users.status，不可操作管理员）
 *
 * 被封禁用户（uni-id-users.status === 1）：可登录浏览，toggleLike / addComment /
 * report / updateUpload / deleteUpload 等写入操作统一被 USER_BANNED 拦截。
 *
 * 评论模型（两级盖楼）：
 *   - 顶级评论：无 parent_id
 *   - 回复：parent_id 指向顶级评论；reply_to={uid,name} 为被回复人快照
 *
 * 所有表 clientDB 权限全部关闭，一切写入在此云函数（管理员权限）内完成。
 */

// 微信 access_token 进程级缓存（实例复用时有效，过期自动重取）
const wxTokenCache = { token: '', expire: 0 };

// 照片标签白名单（发布/筛选共用，前后端保持一致）
const ALLOWED_TAGS = ['风景', '人物', '动漫', '萌宠', '美食', '其他'];

exports.main = async (event, context) => {
	const {
			action,
			id,
			content,
			skip = 0,
			parentId = '',
			replyId = '',
			commentId = '',
			notiId = '',
			status = -1,
			reason = '',
			ids = [],
			handleResult = '',
			targetUid = '',
			keyword = '',
			rankType = '',
			tags = [],
			sortBy = '',
			filterTag = '',
			authorId = '',
			authorKeyword = '',
			dateFrom = 0,
			dateTo = 0,
			excludeIds = [],
			tmplType = ''
		} = event;

	const db = uniCloud.database();
	const dbCmd = db.command;
	const wallpaperCol = db.collection('wallpapers');
	const likeCol = db.collection('wallpaper_likes');
	const commentCol = db.collection('wallpaper_comments');
	const notiCol = db.collection('wallpaper_notifications');
	const subCol = db.collection('wallpaper_subscribes');
	const userCol = db.collection('uni-id-users');
	const reportCol = db.collection('wallpaper_reports');
	const favCol = db.collection('wallpaper_favorites');

	// uni-id-common 校验登录态
	const uniIdInstance = uniIdCommon.createInstance({
		clientInfo: (context && context.clientInfo) || {}
	});
	let uid = null;
	const token =
		(context && context.UNI_ID_TOKEN) ||
		(context && context.clientInfo && context.clientInfo.uniIdToken) ||
		(event && event.uniIdToken) ||
		'';
	if (token) {
		try {
			const checkRes = await uniIdInstance.checkToken(token);
			if (!checkRes.errCode) uid = checkRes.uid;
		} catch (err) {}
	}

	// 给照片列表批量标注当前用户是否已点赞（一次 in 查询，未登录全部 false）
	async function attachLiked(list) {
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

	try {
		switch (action) {
			/* ========== 详情：照片数据 + 当前用户是否已赞 + 最新计数 ========== */
			case 'detail': {
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
			case 'recordView': {
				if (!id) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少照片ID' };
				try {
					await wallpaperCol
						.where({ _id: id, audit_status: 1 })
						.update({ 'info.viewNum': dbCmd.inc(1) });
				} catch (e) {
					// 计数失败不影响浏览主流程
					return { errCode: 0, viewCount: 0 };
				}
				const after = await wallpaperCol.doc(id).field({ 'info.viewNum': true }).get();
				const doc = after.data && after.data[0];
				return { errCode: 0, viewCount: (doc && doc.info && doc.info.viewNum) || 0 };
			}

			/* ========== 相关推荐：同标签已过审照片（无标签则取最新），排除自己，最多 12 条 ========== */
			case 'related': {
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

			/* ========== 点赞 / 取消点赞（切换） ========== */
			case 'toggleLike': {
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
			case 'comments': {
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
			case 'addComment': {
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
			case 'deleteComment': {
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

			/* ========== 我的站内通知列表 ========== */
			case 'notifications': {
				if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
				const LIMIT = 20;
				const listRes = await notiCol
					.where({ user_id: uid })
					.orderBy('create_time', 'desc')
					.skip(skip)
					.limit(LIMIT)
					.get();
				return { errCode: 0, list: listRes.data || [], hasMore: (listRes.data || []).length === LIMIT };
			}

			/* ========== 我的未读通知数 ========== */
			case 'unreadCount': {
				if (!uid) return { errCode: 0, count: 0 };
				const countRes = await notiCol.where({ user_id: uid, is_read: 0 }).count();
				return { errCode: 0, count: countRes.total || 0 };
			}

			/* ========== 标记单条通知已读 ========== */
			case 'markRead': {
				if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
				if (!notiId) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少通知ID' };
				// 带 user_id 条件，越权改不到别人的通知
				await notiCol
					.where({ _id: String(notiId), user_id: uid, is_read: 0 })
					.update({ is_read: 1 });
				return { errCode: 0 };
			}

			/* ========== 全部已读 ========== */
			case 'markAllRead': {
				if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
				await notiCol.where({ user_id: uid, is_read: 0 }).update({ is_read: 1 });
				return { errCode: 0 };
			}

			/* ========== 删除单条通知（消息页左滑删除） ========== */
			case 'deleteNotification': {
				if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
				if (!notiId) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少通知ID' };
				// 带 user_id 条件，越权删不到别人的通知
				await notiCol.where({ _id: String(notiId), user_id: uid }).remove();
				return { errCode: 0 };
			}

			/* ========== 订阅消息配置（模板ID + 当前剩余下发条数，由服务端统一下发） ========== */
			case 'subscribeInfo': {
				const cfg = getWxConfig();
				let remain = 0;
				let auditRemain = 0;
				if (uid) {
					if (cfg.replyTemplateId) {
						const subR = await subCol
							.where({ user_id: uid, tmpl_id: cfg.replyTemplateId })
							.limit(1)
							.get();
						remain = (subR.data && subR.data[0] && subR.data[0].remain) || 0;
					}
					if (cfg.auditTemplateId) {
						const subA = await subCol
							.where({ user_id: uid, tmpl_id: cfg.auditTemplateId })
							.limit(1)
							.get();
						auditRemain = (subA.data && subA.data[0] && subA.data[0].remain) || 0;
					}
				}
				return {
					errCode: 0,
					templateId: cfg.replyTemplateId,
					remain,
					auditTemplateId: cfg.auditTemplateId,
					auditRemain
				};
			}

			/* ========== 微信一次性订阅授权：增加下发额度（tmplType=reply 默认 / audit 审核通知） ========== */
			case 'saveSubscribe': {
				if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
				const cfg = getWxConfig();
				const tmplId = tmplType === 'audit' ? cfg.auditTemplateId : cfg.replyTemplateId;
				if (!tmplId) {
					return { errCode: 'TEMPLATE_NOT_CONFIGURED', errMsg: '订阅模板未配置' };
				}
				const now = Date.now();
				const existed = await subCol
					.where({ user_id: uid, tmpl_id: tmplId })
					.limit(1)
					.get();
				let latestRemain;
				if (existed.data && existed.data.length) {
					latestRemain = (existed.data[0].remain || 0) + 1;
					await subCol.doc(existed.data[0]._id).update({
						remain: latestRemain,
						update_time: now
					});
				} else {
					latestRemain = 1;
					await subCol.add({
						user_id: uid,
						tmpl_id: tmplId,
						remain: 1,
						update_time: now
					});
				}
				return { errCode: 0, remain: latestRemain };
			}

			/* ========== 编辑我的上传：仅可改描述，保存后重新进入待审核 ========== */
			case 'updateUpload': {
				if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
				const banned = await requireActiveUser(userCol, uid);
				if (banned) return banned;
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
			case 'deleteUpload': {
				if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
				const banned = await requireActiveUser(userCol, uid);
				if (banned) return banned;
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

			/* ========== 管理员：全量照片分页列表（status: -1 全部 / 0 待审核 / 1 已通过 / 2 已驳回） ========== */
			case 'adminList': {
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
			case 'auditApprove': {
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
			case 'auditReject': {
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
			case 'adminUpdate': {
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
			case 'adminDelete': {
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

			/* ========== 发布照片（客户端先上传云存储，再调本 action 落库；封禁用户拦截） ========== */
			case 'publish': {
				if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录后再发布' };
				const banned = await requireActiveUser(userCol, uid);
				if (banned) return banned;

				const image = String(event.image || '').trim();
				if (!image) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少图片' };
				const desc = String(event.description || '').trim();
				if (desc.length > 100) return { errCode: 'PARAM_ILLEGAL', errMsg: '描述最多100字' };

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

				// author_id/createTime/audit_status/info 由服务端写入（与原 clientDB forceDefaultValue 语义一致）
				const addRes = await wallpaperCol.add({
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
				});
				return { errCode: 0, id: addRes.id };
			}

			/* ========== 搜索：按描述关键词模糊匹配已审核照片（正则转义防注入） ========== */
			case 'search': {
				const kw = String(keyword == null ? '' : keyword).trim();
				if (!kw) return { errCode: 'PARAM_ILLEGAL', errMsg: '请输入搜索关键词' };
				if (kw.length > 30) return { errCode: 'PARAM_ILLEGAL', errMsg: '关键词最多30字' };

				const LIMIT = 20;
				const reg = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
				const listRes = await wallpaperCol
					.where({ audit_status: 1, description: reg })
					.orderBy('createTime', 'desc')
					.skip(skip)
					.limit(LIMIT)
					.get();
				const list = listRes.data || [];
				await attachLiked(list);
				return { errCode: 0, list, hasMore: list.length === LIMIT };
			}

			/* ========== 用户联想搜索：按昵称模糊匹配，返回候选列表（最多 8 个，仅暴露 uid/昵称/头像） ========== */
			case 'searchUsers': {
				const kw = String(keyword == null ? '' : keyword).trim();
				if (!kw) return { errCode: 0, list: [] };
				if (kw.length > 20) return { errCode: 'PARAM_ILLEGAL', errMsg: '昵称最多20字' };
				const reg = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
				const uRes = await userCol
					.where({ nickname: reg })
					.field({ nickname: true, avatar: true })
					.limit(8)
					.get();
				return { errCode: 0, list: uRes.data || [] };
			}

			/* ========== 排行榜：按点赞/浏览/评论数取 Top20（rankType=like|view|comment） ========== */
			case 'ranking': {
				const field =
					rankType === 'comment' ? 'info.commentNum' :
					rankType === 'view' ? 'info.viewNum' :
					'info.likeNum';
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
			case 'feed': {
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
			if (ak && !authorId) {
					if (ak.length > 20) return { errCode: 'PARAM_ILLEGAL', errMsg: '昵称最多20字' };
					const reg = new RegExp(ak.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
					const uRes = await userCol.where({ nickname: reg }).limit(50).get();
					const uids = (uRes.data || []).map((u) => u._id);
					if (!uids.length) return { errCode: 0, list: [], hasMore: false };
					where.author_id = dbCmd.in(uids);
				}

				if (order === 'random') {
					// aggregate match 用原生 Mongo 语法（dbCmd 命令对象不可复用）
					const match = { audit_status: 1 };
					if (tagSet.length) match.tags = { $in: tagSet };
					if (authorId) match.author_id = authorId;
					if (ak && !authorId) {
						// where.author_id 已解析为 in 命令，这里重新取 uid 列表（最多50个，代价可接受）
						const reg = new RegExp(ak.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
						const uRes = await userCol.where({ nickname: reg }).limit(50).get();
						const uids = (uRes.data || []).map((u) => u._id);
						match.author_id = { $in: uids };
					}
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
					await attachLiked(list);
					return { errCode: 0, list, hasMore: list.length === LIMIT };
				}

				let query = wallpaperCol.where(where);
				if (order === 'hot') query = query.orderBy('info.likeNum', 'desc');
				const listRes = await query.orderBy('createTime', 'desc').skip(skip).limit(LIMIT).get();
				const list = listRes.data || [];
				await attachLiked(list);
				return { errCode: 0, list, hasMore: list.length === LIMIT };
			}

			/* ========== 收藏 / 取消收藏（切换） ========== */
			case 'toggleFavorite': {
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
			case 'favoriteList': {
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
						return { ...wp, _favId: f._id };
					})
					.filter(Boolean);
				return { errCode: 0, list, hasMore: favs.length === LIMIT };
			}

			/* ========== 用户主页：用户信息 + TA 已过审照片分页 ========== */
			case 'userHome': {
				if (!targetUid) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少用户ID' };
				const uRes = await userCol.doc(targetUid).field({ nickname: 1, avatar: 1 }).get();
				const user = uRes.data && uRes.data[0];
				if (!user) return { errCode: 'NOT_FOUND', errMsg: '用户不存在' };

				const LIMIT = 20;
				const listRes = await wallpaperCol
					.where({ author_id: targetUid, audit_status: 1 })
					.orderBy('createTime', 'desc')
					.skip(skip)
					.limit(LIMIT)
					.get();
				const countRes = await wallpaperCol
					.where({ author_id: targetUid, audit_status: 1 })
					.count();
				const list = listRes.data || [];
				return {
					errCode: 0,
					user: { _id: targetUid, nickname: user.nickname || '用户', avatar: user.avatar || '' },
					list,
					hasMore: list.length === LIMIT,
					photoCount: countRes.total || 0
				};
			}

			/* ========== 用户举报：同一人对同一照片仅有1条待处理举报 ========== */
			case 'report': {
				if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录后再举报' };
				const banned = await requireActiveUser(userCol, uid);
				if (banned) return banned;
				if (!id) return { errCode: 'PARAM_ILLEGAL', errMsg: '缺少照片ID' };

				const text = String(reason == null ? '' : reason).trim();
				if (!text) return { errCode: 'PARAM_ILLEGAL', errMsg: '请选择或填写举报原因' };
				if (text.length > 100) return { errCode: 'PARAM_ILLEGAL', errMsg: '举报原因最多100字' };

				const wpRes = await wallpaperCol.doc(id).get();
				const wallpaper = wpRes.data && wpRes.data[0];
				if (!wallpaper) return { errCode: 'NOT_FOUND', errMsg: '照片不存在或已删除' };

				// 防重复：同一举报人对同一照片已有待处理举报时不再新建
				const dup = await reportCol
					.where({ wallpaper_id: id, reporter_id: uid, status: 0 })
					.count();
				if (dup.total) {
					return { errCode: 'REPORT_DUPLICATED', errMsg: '你已举报过该照片，请等待处理' };
				}

				await reportCol.add({
					wallpaper_id: id,
					reporter_id: uid,
					reason: text,
					status: 0,
					create_time: Date.now()
				});
				return { errCode: 0 };
			}

			/* ========== 管理员：批量审核通过（ids 数组，最多 20 条/次） ========== */
			case 'batchApprove': {
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
			case 'adminStats': {
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
			case 'adminReports': {
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
			case 'handleReport': {
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
			case 'adminComments': {
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
			case 'adminDeleteComment': {
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
			case 'adminUsers': {
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
			case 'setUserStatus': {
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

			default:
				return { errCode: 'ACTION_INVALID', errMsg: '未知操作：' + action };
		}
	} catch (e) {
		return { errCode: 'SERVER_ERROR', errMsg: (e && e.message) || '服务异常' };
	}
};

/**
 * 管理员鉴权：仅 uni-id-users.is_admin === 1 放行
 * is_admin 无客户端写入入口，只能在 uniCloud 控制台手动设置，无法伪造
 * @returns {null|object} null=通过；否则为可直接 return 的错误对象
 */
async function requireAdmin(userCol, uid) {
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
	const uRes = await userCol.doc(uid).get();
	const u = uRes.data && uRes.data[0];
	if (!u || u.is_admin !== 1) return { errCode: 'NO_PERMISSION', errMsg: '无管理员权限' };
	return null;
}

/**
 * 登录用户状态校验：status === 1（被禁用）的用户禁止一切写入操作
 * uni-id-users.status 为 uni-id 内置字段（0 正常 / 1 禁用），复用为封禁标记
 * @returns {null|object} null=正常；否则为可直接 return 的错误对象
 */
async function requireActiveUser(userCol, uid) {
	if (!uid) return { errCode: 'LOGIN_REQUIRED', errMsg: '请先登录' };
	const uRes = await userCol.doc(uid).get();
	const u = uRes.data && uRes.data[0];
	if (u && u.status === 1) {
		return { errCode: 'USER_BANNED', errMsg: '账号已被禁用，无法执行此操作' };
	}
	return null;
}

/**
 * 读取 wallpaper-action 配置（uni-config-center/wallpaper-action/config.json）
 * 微信 appid/appsecret 复用 user-login 的配置
 */
function getWxConfig() {
	const actionCfg = createConfig({ pluginId: 'wallpaper-action' }).config() || {};
	let loginCfg = {};
	try {
		loginCfg = createConfig({ pluginId: 'user-login' }).config() || {};
	} catch (e) {
		loginCfg = {};
	}
	return {
		appid: loginCfg.appid || '',
		appsecret: loginCfg.appsecret || '',
		replyTemplateId: (actionCfg.wx && actionCfg.wx.replyTemplateId) || '',
		auditTemplateId: (actionCfg.wx && actionCfg.wx.auditTemplateId) || '',
		miniState: (actionCfg.wx && actionCfg.wx.miniState) || 'developer',
		page: (actionCfg.wx && actionCfg.wx.page) || 'pages/Home/index'
	};
}

async function getWxAccessToken() {
	if (wxTokenCache.token && wxTokenCache.expire > Date.now()) {
		return wxTokenCache.token;
	}
	const cfg = getWxConfig();
	const httpRes = await uniCloud.httpclient.request(
		'https://api.weixin.qq.com/cgi-bin/token',
		{
			method: 'GET',
			data: {
				grant_type: 'client_credential',
				appid: cfg.appid,
				secret: cfg.appsecret
			},
			dataType: 'json',
			timeout: 10000
		}
	);
	const body = httpRes && httpRes.data;
	if (!body || !body.access_token) {
		throw new Error((body && body.errmsg) || '获取access_token失败');
	}
	wxTokenCache.token = body.access_token;
	wxTokenCache.expire = Date.now() + (Number(body.expires_in) - 300) * 1000;
	return body.access_token;
}

/**
 * 微信文本内容安全检测 security.msgSecCheck（v2）
 * scene: 1资料 2评论 3论坛 4日志
 * @returns {{pass:boolean}} suggest=pass 才放行；接口本身异常时抛错由调用方容错
 */
async function checkTextRisk(openid, content) {
	const cfg = getWxConfig();
	if (!cfg.appid || !cfg.appsecret || !openid) return { pass: true };
	const accessToken = await getWxAccessToken();
	const httpRes = await uniCloud.httpclient.request(
		'https://api.weixin.qq.com/wxa/msg_sec_check?access_token=' + encodeURIComponent(accessToken),
		{
			method: 'POST',
			contentType: 'json',
			data: {
				version: 2,
				scene: 2,
				openid,
				content: String(content || '').slice(0, 2500)
			},
			dataType: 'json',
			timeout: 10000
		}
	);
	const body = httpRes && httpRes.data;
	if (!body || body.errcode !== 0 || !body.result) {
		const e = new Error((body && body.errmsg) || 'msgSecCheck无结果');
		e.body = body;
		throw e;
	}
	return { pass: body.result.suggest === 'pass', detail: body.result };
}

function pad2(n) {
	return String(n).padStart(2, '0');
}

function formatTmplTime(ts) {
	const d = new Date(ts);
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 给被回复人下发一条微信「一次性订阅消息」
 * 前置：接收人有剩余额度（remain>0，每次授权+1）
 * 注意：模板字段名需与公众平台申请的模板一致，如不一致请按实际模板调整下方 data。
 */
async function sendReplySubscribe(db, dbCmd, noti) {
	const cfg = getWxConfig();
	if (!cfg.replyTemplateId) return; // 未配置模板，仅保留站内通知
	if (!cfg.appid || !cfg.appsecret) return;

	const subRes = await db
		.collection('wallpaper_subscribes')
		.where({ user_id: noti.user_id, tmpl_id: cfg.replyTemplateId })
		.limit(1)
		.get();
	const sub = subRes.data && subRes.data[0];
	if (!sub || !sub.remain || sub.remain <= 0) return;

	// 取接收人 openid
	const userRes = await db.collection('uni-id-users').doc(noti.user_id).get();
	const targetUser = userRes.data && userRes.data[0];
	const openid = targetUser && targetUser.wx_openid;
	if (!openid) return;

	const accessToken = await getWxAccessToken();
	// thing 类型内容最长 20 个字符
	const thing = (s) => String(s || '').slice(0, 20);
	const postBody = {
		touser: openid,
		template_id: cfg.replyTemplateId,
		page: cfg.page,
		miniprogram_state: cfg.miniState,
		lang: 'zh_CN',
		data: {
			thing1: { value: thing(noti.from && noti.from.name) || '用户' },
			thing2: { value: thing(noti.content) },
			time3: { value: formatTmplTime(noti.create_time) }
		}
	};

	const httpRes = await uniCloud.httpclient.request(
		'https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=' + encodeURIComponent(accessToken),
		{
			method: 'POST',
			contentType: 'json',
			data: postBody,
			dataType: 'json',
			timeout: 10000
		}
	);
	const body = httpRes && httpRes.data;
	const errcode = body ? body.errcode : -1;

	if (errcode === 0) {
		// 下发成功，消耗一次额度
		await db
			.collection('wallpaper_subscribes')
			.doc(sub._id)
			.update({ remain: dbCmd.inc(-1), update_time: Date.now() });
	} else if (errcode === 43101 || errcode === 40003) {
		// 43101: 用户未订阅/额度已尽；40003: openid 无效 —— 额度清零避免无效重试
		await db
			.collection('wallpaper_subscribes')
			.doc(sub._id)
			.update({ remain: 0, update_time: Date.now() });
	} else {
		console.error('[wallpaper-action] subscribe/send 失败', body);
	}
}

/**
 * 给作者下发「审核结果」微信订阅消息（通过/驳回）
 * 额度体系与评论回复通知共用 wallpaper_subscribes（tmpl_id 不同，互不干扰）
 * 模板字段（公共模板库「审核结果通知」：审核结果/审核时间/备注）：
 *   phrase1=审核结果  time2=审核时间  thing3=备注
 * 若 47003 报错，按公众平台模板详情页的实际字段名调整下方 data。
 */
async function sendAuditSubscribe(db, dbCmd, uid, { description, passed, reason }) {
	const cfg = getWxConfig();
	if (!cfg.auditTemplateId) {
		console.log('[wallpaper-action] audit 订阅跳过：未配置 wx.auditTemplateId');
		return;
	}
	if (!cfg.appid || !cfg.appsecret) {
		console.log('[wallpaper-action] audit 订阅跳过：缺少 appid/appsecret');
		return;
	}

	const subRes = await db
		.collection('wallpaper_subscribes')
		.where({ user_id: uid, tmpl_id: cfg.auditTemplateId })
		.limit(1)
		.get();
	const sub = subRes.data && subRes.data[0];
	if (!sub || !sub.remain || sub.remain <= 0) {
		console.log('[wallpaper-action] audit 订阅跳过：用户无下发额度 uid=' + uid);
		return;
	}

	const userRes = await db.collection('uni-id-users').doc(uid).get();
	const targetUser = userRes.data && userRes.data[0];
	const openid = targetUser && targetUser.wx_openid;
	if (!openid) {
		console.log('[wallpaper-action] audit 订阅跳过：用户无 wx_openid uid=' + uid);
		return;
	}

	const accessToken = await getWxAccessToken();
	const thing = (s) => String(s || '').slice(0, 20);
	const postBody = {
		touser: openid,
		template_id: cfg.auditTemplateId,
		page: 'pages/MyUploads/my-uploads',
		miniprogram_state: cfg.miniState,
		lang: 'zh_CN',
		data: {
			phrase1: { value: passed ? '审核通过' : '审核不通过' },
			time2: { value: formatTmplTime(Date.now()) },
			thing3: { value: thing(passed ? '已公开展示' : reason || '请查看详情') }
		}
	};

	const httpRes = await uniCloud.httpclient.request(
		'https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=' + encodeURIComponent(accessToken),
		{
			method: 'POST',
			contentType: 'json',
			data: postBody,
			dataType: 'json',
			timeout: 10000
		}
	);
	const body = httpRes && httpRes.data;
	const errcode = body ? body.errcode : -1;

	if (errcode === 0) {
		await db
			.collection('wallpaper_subscribes')
			.doc(sub._id)
			.update({ remain: dbCmd.inc(-1), update_time: Date.now() });
	} else if (errcode === 43101 || errcode === 40003) {
		await db
			.collection('wallpaper_subscribes')
			.doc(sub._id)
			.update({ remain: 0, update_time: Date.now() });
	} else {
		console.error('[wallpaper-action] audit subscribe/send 失败', body);
	}
}
