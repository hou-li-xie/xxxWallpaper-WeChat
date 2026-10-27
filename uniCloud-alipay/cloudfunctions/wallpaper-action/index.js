'use strict';
const uniIdCommon = require('uni-id-common');

const feed = require('./modules/feed');
const photo = require('./modules/photo');
const interaction = require('./modules/interaction');
const notify = require('./modules/notify');
const user = require('./modules/user');
const admin = require('./modules/admin');
const app = require('./modules/app');

/**
 * 照片互动云函数（入口只做：token 校验 → 上下文构建 → action 分发）
 *
 * action 一览：
 *   detail        照片详情 + 点赞态 + 计数                    [modules/photo]
 *   recordView    浏览量 +1（客户端本地 10 分钟去重）           [modules/photo]
 *   publish       发布照片落库（封禁用户拦截）                 [modules/photo]
 *   updateUpload  编辑我的上传（重新进入待审核）               [modules/photo]
 *   deleteUpload  删除我的上传（级联清理 + 删云存储文件）       [modules/photo]
 *   related       相关推荐（同标签已过审照片，不足补最新）      [modules/feed]
 *   search        按描述关键词搜索已审核照片                   [modules/feed]
 *   searchUsers   用户联想搜索（按昵称模糊匹配）               [modules/feed]
 *   ranking       排行榜 Top20（点赞/评论/浏览）               [modules/feed]
 *   feed          首页信息流：sortBy=new|hot|random + 组合筛选  [modules/feed]
 *   toggleLike    点赞 / 取消点赞                             [modules/interaction]
 *   comments      顶级评论分页 + 回复盖楼                      [modules/interaction]
 *   addComment    发表评论 / 回复（写站内通知 + 微信订阅消息）   [modules/interaction]
 *   deleteComment 删除自己的评论（顶级评论级联删除回复）        [modules/interaction]
 *   toggleFavorite 收藏 / 取消收藏                             [modules/interaction]
 *   favoriteList  我的收藏分页                                 [modules/interaction]
 *   notifications 我的站内通知列表                             [modules/notify]
 *   unreadCount   我的未读通知数                               [modules/notify]
 *   markRead      标记单条通知已读                             [modules/notify]
 *   markAllRead   全部已读                                     [modules/notify]
 *   deleteNotification 删除单条通知                            [modules/notify]
 *   subscribeInfo 订阅消息配置 + 剩余下发条数                  [modules/notify]
 *   saveSubscribe 微信一次性订阅授权后增加下发额度              [modules/notify]
 *   checkUpdate   App 热更新检测                               [modules/app]
 *   userHome      用户主页（用户信息 + 已过审照片分页）         [modules/user]
 *   heartbeat     心跳上报（最后活跃时间）                     [modules/user]
 *   report        用户举报照片                                 [modules/user]
 *
 * 管理员 action（均需 uni-id-users.is_admin === 1，is_admin 只能在 uniCloud 控制台手动设置）：
 *   adminList    全量照片分页列表            [modules/admin]
 *   auditApprove 审核通过                    [modules/admin]
 *   auditReject  审核驳回（必填驳回原因）     [modules/admin]
 *   adminUpdate  管理员修改描述              [modules/admin]
 *   adminDelete  管理员删除任意照片（级联）   [modules/admin]
 *   batchApprove 批量审核通过（最多 20 条/次）[modules/admin]
 *   adminStats   数据概览统计                [modules/admin]
 *   adminReports 举报分页列表                [modules/admin]
 *   handleReport 处理举报                    [modules/admin]
 *   adminComments    全量评论分页            [modules/admin]
 *   adminDeleteComment 删除任意评论          [modules/admin]
 *   adminUsers     用户分页列表              [modules/admin]
 *   setUserStatus 封禁/解封用户              [modules/admin]
 *
 * 被封禁用户（uni-id-users.status === 1）：可登录浏览，toggleLike / addComment /
 * report / updateUpload / deleteUpload 等写入操作统一被 USER_BANNED 拦截。
 *
 * 评论模型（两级盖楼）：
 *   - 顶级评论：无 parent_id
 *   - 回复：parent_id 指向顶级评论；reply_to={uid,name} 为被回复人快照
 *
 * 所有表 clientDB 权限全部关闭，一切写入在此云函数（管理员权限）内完成。
 *
 * 模块结构：
 *   common/  纯函数工具（鉴权/内容安全/限流/微信配置与订阅消息）
 *   modules/ 按业务领域拆分的 action 处理器，每个 handler 接收统一 ctx
 */

// action → 处理函数 注册表（各模块导出同名 action 处理器）
const ACTION_HANDLERS = {
	...photo,
	...feed,
	...interaction,
	...notify,
	...user,
	...app,
	...admin
};

exports.main = async (event, context) => {
	try {
		const { action } = event || {};

		const db = uniCloud.database();
		const dbCmd = db.command;

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

		// 客户端 IP（用于限流标识，取不到时回退到 'unknown'）
		const clientIp =
			(context && context.CLIENTIP) ||
			(context && context.clientInfo && context.clientInfo.clientIP) ||
			'unknown';
		// 限流调用方标识：登录用户用 uid，未登录用 IP
		const callerId = uid || clientIp;

		const handler = ACTION_HANDLERS[action];
		if (!handler) {
			return { errCode: 'ACTION_INVALID', errMsg: '未知操作：' + action };
		}

		// 统一上下文：所有集合句柄 + 登录态 + 限流标识，各模块按需解构
		const ctx = {
			event: event || {},
			db,
			dbCmd,
			wallpaperCol: db.collection('wallpapers'),
			likeCol: db.collection('wallpaper_likes'),
			commentCol: db.collection('wallpaper_comments'),
			notiCol: db.collection('wallpaper_notifications'),
			subCol: db.collection('wallpaper_subscribes'),
			userCol: db.collection('uni-id-users'),
			reportCol: db.collection('wallpaper_reports'),
			favCol: db.collection('wallpaper_favorites'),
			uid,
			callerId
		};

		return await handler(ctx);
	} catch (e) {
		console.error('[wallpaper-action] 未捕获异常:', e && e.stack ? e.stack : e);
		return { errCode: 'SERVER_ERROR', errMsg: (e && e.message) || '服务异常' };
	}
};
