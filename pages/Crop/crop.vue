<template>
	<view class="crop-page">
		<!-- 自定义顶部栏：右上角是微信胶囊，右侧不放任何按钮 -->
		<view class="toolbar" :style="{ paddingTop: barTop + 'px', height: barTop + barHeight + 'px' }">
			<view class="bar-inner" :style="{ height: barHeight + 'px' }">
				<view class="tool-btn" @click="cancel">取消</view>
				<text class="tool-title">拖动/双指缩放调整</text>
				<view class="bar-placeholder"></view>
			</view>
		</view>

		<!-- 裁剪舞台：黑底 + 中间固定比例亮区，亮区外做半透明遮罩 -->
		<view class="stage">
			<view class="crop-wrap" :style="{ width: areaW + 'px', height: areaH + 'px' }">
				<movable-area class="crop-area">
					<movable-view
						class="crop-view"
						direction="all"
						:x="initPos.x"
						:y="initPos.y"
						:scale="true"
						:scale-min="1"
						:scale-max="3"
						:style="{ width: viewW + 'px', height: viewH + 'px' }"
						@change="onMoveChange"
						@scale="onScaleChange"
					>
						<!-- 必须用 v-bind 传布尔，静态字符串 "false" 会被当成 true，长按仍弹保存菜单 -->
						<image
							class="crop-img"
							:src="imageSrc"
							mode="scaleToFill"
							:show-menu-by-longpress="false"
						></image>
					</movable-view>
				</movable-area>

				<!-- 裁剪框覆盖层：明显白边 + 蓝色四角，pointer-events:none 不拦截拖动手势 -->
				<view class="crop-mask">
					<view class="corner tl"></view>
					<view class="corner tr"></view>
					<view class="corner bl"></view>
					<view class="corner br"></view>
				</view>
			</view>
		</view>

		<!-- 底部操作区：完成按钮放这里，避开微信胶囊；padding 适配全面屏底部安全区 -->
		<view class="bottom-bar" :style="{ paddingBottom: safeBottom + 12 + 'px' }">
			<view class="bottom-tip">
				<uni-icons type="image" size="16" color="#8fb6d6"></uni-icons>
				<text>保留原图比例 · 长边最高 1080px</text>
			</view>
			<view class="confirm-btn" :class="{ disabled: exporting }" @click="confirm">
				{{ exporting ? '处理中' : '完成' }}
			</view>
		</view>

		<!-- 离屏导出画布：CSS 缩到 1px 不可见；导出像素随裁剪比例动态设置 -->
		<canvas id="cropCanvas" type="2d" class="export-canvas"></canvas>
	</view>
</template>

<script setup lang="ts">
	import { ref, reactive, getCurrentInstance } from 'vue';
	import { onLoad } from '@dcloudio/uni-app';

	// ===== 自由比例裁剪：裁剪框跟随原图宽高比（横图横裁、竖图竖裁）=====
	// 导出像素保留裁剪框比例，长边最高 OUT_LONG，且不超过源裁剪区像素（不放大）
	const OUT_LONG = 1080;

	const instance = getCurrentInstance();

	// 顶部自定义栏几何（按微信胶囊真实位置对齐，避免遮挡）
	const barTop = ref(20);
	const barHeight = ref(44);
	// 底部安全区高度（全面屏 home 指示条）
	const safeBottom = ref(0);
	const imageSrc = ref('');
	const areaW = ref(0); // 裁剪框宽（逻辑像素）
	const areaH = ref(0); // 裁剪框高（逻辑像素）
	const viewW = ref(0); // movable-view 初始宽（scale=1 时，图片 cover 裁剪框）
	const viewH = ref(0);
	const initPos = reactive({ x: 0, y: 0 });
	const exporting = ref(false);

	// 手势实时状态（只存不回绑模板，避免与手势争夺位置）
	const gesture = { x: 0, y: 0, scale: 1 };
	// 原图自然尺寸 & 本地可用路径（getImageInfo 后）
	let naturalW = 0;
	let naturalH = 0;
	let decodedPath = '';

	onLoad((options: any) => {
		if (!options || !options.src) {
			uni.showToast({ title: '图片参数缺失', icon: 'none' });
			setTimeout(() => uni.navigateBack(), 600);
			return;
		}
		imageSrc.value = decodeURIComponent(options.src);

		const sys = uni.getSystemInfoSync();
		safeBottom.value = (sys.safeAreaInsets && sys.safeAreaInsets.bottom) || 0;

		// 微信胶囊位置：自定义栏上边缘/高度与胶囊对齐；非微信端退回状态栏 + 44px
		let menuRect = null;
		// #ifdef MP-WEIXIN
		try {
			menuRect = uni.getMenuButtonBoundingClientRect();
		} catch (err) {
			menuRect = null;
		}
		// #endif
		if (menuRect && menuRect.height) {
			barTop.value = menuRect.top;
			barHeight.value = menuRect.height;
		} else {
			barTop.value = sys.statusBarHeight || 20;
			barHeight.value = 44;
		}

		prepare(sys);
	});

	async function prepare(sys: any) {
		// 1. 读取图片自然尺寸（同时纠正 EXIF 方向、获得 canvas 可解码路径）
		try {
			const info = await uni.getImageInfo({ src: imageSrc.value });
			naturalW = info.width;
			naturalH = info.height;
			decodedPath = info.path || imageSrc.value;
		} catch (e) {
			uni.showToast({ title: '图片读取失败', icon: 'none' });
			return;
		}

		// 2. 计算裁剪框：比例跟随原图，在舞台可用区域内尽量大（横图横框、竖图竖框）
		// 顶部 = 自定义栏(对齐胶囊) + 间距；底部 = 提示 + 完成按钮 + 底部安全区
		const toolbarPx = barTop.value + barHeight.value + 8;
		const bottomPx = 28 + 44 + 12 + safeBottom.value + 16;
		const maxW = sys.windowWidth - 32;
		const maxH = sys.windowHeight - toolbarPx - bottomPx - 24;

		const imgRatio = naturalW / naturalH;
		// 先按宽撑满；若高度超出舞台，则改按高适配
		let w = maxW;
		let h = w / imgRatio;
		if (h > maxH) {
			h = maxH;
			w = h * imgRatio;
		}
		areaW.value = Math.round(w);
		areaH.value = Math.round(h);

		// 3. 初始让图片 cover 裁剪框（不留白），movable-view 尺寸 = 图片显示尺寸
		const areaRatio = areaW.value / areaH.value;
		let vw;
		let vh;
		if (imgRatio > areaRatio) {
			// 图更宽：以高对齐，宽超出
			vh = areaH.value;
			vw = vh * imgRatio;
		} else {
			// 图更高：以宽对齐，高超出
			vw = areaW.value;
			vh = vw / imgRatio;
		}
		viewW.value = Math.round(vw);
		viewH.value = Math.round(vh);
		initPos.x = Math.round((areaW.value - viewW.value) / 2);
		initPos.y = Math.round((areaH.value - viewH.value) / 2);
		gesture.x = initPos.x;
		gesture.y = initPos.y;
	}

	function onMoveChange(e: any) {
		const d = e.detail || {};
		if (typeof d.x === 'number') gesture.x = d.x;
		if (typeof d.y === 'number') gesture.y = d.y;
		if (typeof d.scale === 'number') gesture.scale = d.scale;
	}

	function onScaleChange(e: any) {
		const d = e.detail || {};
		if (typeof d.scale === 'number') gesture.scale = d.scale;
		if (typeof d.x === 'number') gesture.x = d.x;
		if (typeof d.y === 'number') gesture.y = d.y;
	}

	function cancel() {
		uni.navigateBack();
	}

	async function confirm() {
		if (exporting.value) return;
		if (!viewW.value) {
			return uni.showToast({ title: '图片尚未就绪', icon: 'none' });
		}
		exporting.value = true;
		uni.showLoading({ title: '处理中', mask: true });
		try {
			const result = await drawAndExport();
			const ec = instance.proxy.getOpenerEventChannel();
			ec.emit('cropDone', result);
			uni.navigateBack();
		} catch (e) {
			uni.showToast({ title: (e && e.message) || '裁剪失败，请重试', icon: 'none' });
		} finally {
			exporting.value = false;
			uni.hideLoading();
		}
	}

	// canvas 2d 按手势状态导出裁剪区域：比例跟随裁剪框，长边最高 1080、不放大
	// resolve { path, width, height }，width/height 随发布落库供瀑布流布局使用
	function drawAndExport(): Promise<any> {
		return new Promise((resolve, reject) => {
			const query = uni.createSelectorQuery().in(instance.proxy);
			query
				.select('#cropCanvas')
				.fields({ node: true, size: true })
				.exec((qRes) => {
					if (!qRes || !qRes[0] || !qRes[0].node) {
						return reject(new Error('画布初始化失败'));
					}
					const canvas = qRes[0].node;
					const ctx = canvas.getContext('2d');

					const img = canvas.createImage();
					img.onload = () => {
						// 显示尺寸 -> 原图像素 的换算比
						const ratioX = naturalW / viewW.value;
						const ratioY = naturalH / viewH.value;
						const scale = gesture.scale || 1;
						// 裁剪框对应的原图区域
						const sx = (-gesture.x / scale) * ratioX;
						const sy = (-gesture.y / scale) * ratioY;
						const sWidth = (areaW.value / scale) * ratioX;
						const sHeight = (areaH.value / scale) * ratioY;

						// 输出尺寸：与裁剪框同比例；长边不超过 1080 且不超过源像素（不放大）
						const frameRatio = areaW.value / areaH.value;
						const srcLong = Math.max(sWidth, sHeight);
						const outLong = Math.min(OUT_LONG, Math.max(1, Math.round(srcLong)));
						let outW;
						let outH;
						if (frameRatio >= 1) {
							outW = outLong;
							outH = Math.max(1, Math.round(outLong / frameRatio));
						} else {
							outH = outLong;
							outW = Math.max(1, Math.round(outLong * frameRatio));
						}
						canvas.width = outW;
						canvas.height = outH;

						ctx.clearRect(0, 0, outW, outH);
						ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, outW, outH);

						uni.canvasToTempFilePath(
							{
								canvas,
								x: 0,
								y: 0,
								width: outW,
								height: outH,
								destWidth: outW,
								destHeight: outH,
								fileType: 'jpg',
								// 长边 1080 下 0.9 质量体积可控、细节保留好
								quality: 0.9,
								success: (r) => resolve({ path: r.tempFilePath, width: outW, height: outH }),
								fail: (err) => reject(new Error((err && err.errMsg) || '导出失败'))
							},
							instance.proxy
						);
					};
					img.onerror = () => reject(new Error('图片解码失败'));
					img.src = decodedPath;
				});
		});
	}
</script>

<style lang="scss">
	.crop-page {
		width: 100vw;
		height: 100vh;
		background: #000;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.toolbar {
		background: #111;
		box-sizing: border-box;
		flex-shrink: 0;

		.bar-inner {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 0 16rpx;
			box-sizing: border-box;
		}

		.tool-btn {
			font-size: 15px;
			color: #ccc;
			padding: 6rpx 12rpx;
		}

		// 与左侧取消按钮等宽的占位，保证标题视觉居中
		.bar-placeholder {
			width: 64rpx;
			height: 1px;
		}

		.tool-title {
			font-size: 14px;
			color: #888;
		}
	}

	.stage {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}

	.crop-wrap {
		position: relative;
	}

	.crop-area {
		width: 100%;
		height: 100%;
		background: #000;
	}

	.crop-view {
		.crop-img {
			width: 100%;
			height: 100%;
			display: block;
			// 多端兜底：禁止图片被长按选中/呼叫系统菜单
			-webkit-touch-callout: none;
			user-select: none;
		}
	}

	// 裁剪框覆盖层：半透明遮罩 + 明显白边，层级在图片之上但不拦截手势
	.crop-mask {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		box-sizing: border-box;
		border: 4rpx solid #ffffff;
		box-shadow: 0 0 0 2000rpx rgba(0, 0, 0, 0.65);
		pointer-events: none;
		z-index: 5;

		.corner {
			position: absolute;
			width: 40rpx;
			height: 40rpx;
			border-color: #4facfe;
			border-style: solid;
			border-width: 0;
		}

		.tl {
			top: -8rpx;
			left: -8rpx;
			border-top-width: 8rpx;
			border-left-width: 8rpx;
			border-top-left-radius: 8rpx;
		}

		.tr {
			top: -8rpx;
			right: -8rpx;
			border-top-width: 8rpx;
			border-right-width: 8rpx;
			border-top-right-radius: 8rpx;
		}

		.bl {
			bottom: -8rpx;
			left: -8rpx;
			border-bottom-width: 8rpx;
			border-left-width: 8rpx;
			border-bottom-left-radius: 8rpx;
		}

		.br {
			bottom: -8rpx;
			right: -8rpx;
			border-bottom-width: 8rpx;
			border-right-width: 8rpx;
			border-bottom-right-radius: 8rpx;
		}
	}

	.bottom-bar {
		flex-shrink: 0;
		background: #111;
		padding: 16rpx 40rpx 0;
		box-sizing: content-box;

		.bottom-tip {
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 10rpx;
			font-size: 24rpx;
			color: #8fb6d6;
			margin-bottom: 20rpx;
		}

		.confirm-btn {
			height: 88rpx;
			border-radius: 44rpx;
			background: linear-gradient(90deg, #4facfe 0%, #2c98e7 100%);
			color: #fff;
			font-size: 32rpx;
			font-weight: bold;
			display: flex;
			align-items: center;
			justify-content: center;
			letter-spacing: 4rpx;

			&.disabled {
				opacity: 0.5;
			}
		}
	}

	// 离屏画布：不可见但保持可绘制（部分安卓机对屏幕外节点导出空白，故缩到 1px）
	.export-canvas {
		position: fixed;
		right: 0;
		bottom: 0;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
</style>
