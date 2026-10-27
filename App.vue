<script lang="ts">
	import { useAppConfigStore } from './store/app-config';
	import { useUserStore } from './store/user';
	import { useMessageStore } from './store/message';

	export default {
		onLaunch: function() {
			// 全局 store 初始化：内容开关 / 登录态 / 未读角标事件
			useAppConfigStore().init();
			useUserStore().init();
			useMessageStore().init();
		},
		onShow: function() {
			// 每次回到前台（含从微信服务通知/聊天返回）刷新未读角标
			useMessageStore().refreshBadge();
		},
		onHide: function() {},
		onShareAppMessage() {
		    return {
		      title: '分享标题',
		      path: '/pages/Home/index',
		      imageUrl: '/static/logo.jpeg'
		    }
		  }
	}
</script>

<style lang="scss">
	/*每个页面公共css */
	@import "/uni_modules/uni-icons/components/uni-icons/uniicons.css";

	element{
		box-sizing: border-box;
		margin: 0;
		padding: 0;
	}

	/* ===== 通用动画（全局可用） ===== */
	@keyframes fade-up-kf {
		from {
			opacity: 0;
			transform: translateY(24rpx);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* 列表项/评论进场渐入 */
	.fade-up {
		animation: fade-up-kf 0.35s ease both;
	}

	@keyframes pop-kf {
		0% { transform: scale(1); }
		40% { transform: scale(1.35); }
		70% { transform: scale(0.88); }
		100% { transform: scale(1); }
	}

	/* 点击弹跳（点赞等） */
	.pop-anim {
		animation: pop-kf 0.4s ease;
	}

	@keyframes fade-in-kf {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@keyframes slide-up-kf {
		from {
			opacity: 0;
			transform: translateY(60rpx);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* 弹窗过场：命中各页面通用遮罩/面板类名 */
	.dialog-mask,
	.edit-mask {
		animation: fade-in-kf 0.2s ease both;
	}

	.dialog,
	.edit-dialog {
		animation: slide-up-kf 0.25s ease both;
	}

	/* ===== 骨架屏系统（全局） =====
	 * 约定：所有骨架灰块共用同一道斜向光带 .sk-shine，每 1.5s 从左往右扫过一次；
	 * 数据到达后 .sk-layer 淡出并移除，真实内容块以 .reveal-blk 错位浮现。 */

	/* 骨架覆盖层：绝对定位铺在真实内容之上，自身不影响布局（不引起跳动） */
	.sk-layer {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		z-index: 6;
		overflow: hidden;
		pointer-events: none; /* 加载期不拦截滚动/点击 */
		background: #f5f7fa; /* 与页面底色一致，避免闪白 */
		transition: opacity 0.3s ease;
	}

	/* 淡出态：与真实内容交错过渡 */
	.sk-layer.sk-out {
		opacity: 0;
	}

	/* 骨架灰块 */
	.sk {
		background: #eaeef4;
		border-radius: 12rpx;
	}

	/* 共用光带：柔和、斜向，1.5s 从左往右扫过一次 */
	.sk-shine {
		position: absolute;
		top: -25%;
		left: 0;
		width: 50%;
		height: 150%;
		pointer-events: none;
		background: linear-gradient(
			100deg,
			rgba(255, 255, 255, 0) 0%,
			rgba(255, 255, 255, 0.45) 40%,
			rgba(255, 255, 255, 0.85) 50%,
			rgba(255, 255, 255, 0.45) 60%,
			rgba(255, 255, 255, 0) 100%
		);
		animation: sk-sweep-kf 1.5s linear infinite;
	}

	@keyframes sk-sweep-kf {
		0% { transform: translateX(-130%) skewX(-16deg); }
		100% { transform: translateX(270%) skewX(-16deg); }
	}

	/* 真实内容块依次浮现：淡入 + 上移 8px（16rpx），块间延迟由内联 animation-delay 错开 */
	@keyframes reveal-kf {
		from {
			opacity: 0;
			transform: translateY(16rpx);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.reveal-blk {
		animation: reveal-kf 0.42s cubic-bezier(0.22, 0.61, 0.36, 1) both;
	}
</style>
