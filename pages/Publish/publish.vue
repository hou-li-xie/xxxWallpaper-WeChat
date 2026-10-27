<template>
	<view class="publish-page">
		<!-- 图片区：预览尺寸跟随裁剪结果真实比例 -->
		<view
			class="image-box"
			:class="{ 'is-preview': croppedPath }"
			:style="previewBoxStyle"
			@click="chooseImage"
		>
			<image v-if="croppedPath" class="preview" :src="croppedPath" mode="aspectFill"></image>
			<view v-else class="placeholder">
				<uni-icons type="camera-filled" size="46" color="#9bb8d3"></uni-icons>
				<text class="ph-title">选择图片</text>
				<text class="ph-tip">选图后可拖动、缩放裁剪</text>
				<text class="ph-size">保留原图比例 · 长边最高1080px</text>
			</view>
			<view v-if="croppedPath" class="reselect">
				<uni-icons type="refreshempty" size="16" color="#fff"></uni-icons>
				<text>重新选择</text>
			</view>
		</view>

		<!-- 标签 -->
	<view class="form-card tags-card">
		<view class="tag-title">选择标签（最多2个）</view>
		<view class="tag-list">
			<view
				v-for="t in tagOptions"
				:key="t"
				class="tag-chip"
				:class="{ active: selectedTags.indexOf(t) !== -1 }"
				@click="toggleTag(t)"
			>
				{{ t }}
			</view>
		</view>
	</view>

	<!-- 描述 -->
	<view class="form-card">
		<textarea
			class="desc-input"
			v-model="description"
			placeholder="说点什么，介绍一下这张美图吧～"
			placeholder-class="input-placeholder"
			maxlength="100"
			:auto-height="true"
		/>
		<view class="word-count">{{ description.length }}/100</view>
	</view>

		<button class="submit-btn" :class="{ disabled: !canSubmit || publishing }" :disabled="!canSubmit || publishing" @click="handlePublish">
			{{ publishing ? '发布中...' : '发布照片' }}
		</button>
	</view>
</template>

<script setup lang="ts">
	import { ref, computed } from 'vue';
	import { requireLogin, getUserInfo } from '../../utils/auth';

	const croppedPath = ref(''); // 裁剪后的本地临时路径
	const cropWidth = ref(0); // 裁剪输出宽（随发布落库，供瀑布流布局）
	const cropHeight = ref(0); // 裁剪输出高
	const description = ref('');
	const publishing = ref(false);
	const tagOptions = ['风景', '人物', '动漫', '萌宠', '美食', '其他'];
	const selectedTags = ref<string[]>([]);

	const canSubmit = computed(() => !!croppedPath.value);

	// 预览框尺寸（rpx）：跟随图片真实比例，横图横显、竖图竖显，限制最大宽高
	const PREVIEW_MAX_W = 562;
	const PREVIEW_MAX_H = 680;
	const previewBoxStyle = computed(() => {
		if (!croppedPath.value || !cropWidth.value || !cropHeight.value) return {};
		const ratio = cropWidth.value / cropHeight.value;
		let pw = PREVIEW_MAX_W;
		let ph = PREVIEW_MAX_W / ratio;
		if (ph > PREVIEW_MAX_H) {
			ph = PREVIEW_MAX_H;
			pw = PREVIEW_MAX_H * ratio;
		}
		return { width: Math.round(pw) + 'rpx', height: Math.round(ph) + 'rpx' };
	});

	// 标签多选（最多2个，超出时顶掉最早选择的）
	function toggleTag(t: string) {
		const i = selectedTags.value.indexOf(t);
		if (i !== -1) {
			selectedTags.value.splice(i, 1);
		} else {
			if (selectedTags.value.length >= 2) selectedTags.value.shift();
			selectedTags.value.push(t);
		}
	}

	// 选图 -> 裁剪页，裁剪结果通过 eventChannel 回传
	function chooseImage() {
		// 上传前强制登录校验，登录后自动回本页
		if (!requireLogin('/pages/Publish/publish')) return;

		uni.chooseImage({
			count: 1,
			sizeType: ['compressed'],
			sourceType: ['album', 'camera'],
			success: (res: any) => {
				const tempPath = res.tempFilePaths && res.tempFilePaths[0];
				if (!tempPath) return;
				uni.navigateTo({
					url: '/pages/Crop/crop?src=' + encodeURIComponent(tempPath),
					events: {
					cropDone: (data: any) => {
						if (data && data.path) {
							croppedPath.value = data.path;
							cropWidth.value = data.width || 0;
							cropHeight.value = data.height || 0;
						}
					}
					}
				});
			},
			fail: (err: any) => {
				// 用户取消选图不提示；其余失败（如隐私协议未配置、相册权限被拒）给出可见反馈
				const msg = (err && err.errMsg) || '';
				if (msg.indexOf('cancel') > -1) return;
				if (msg.indexOf('privacy agreement') > -1) {
					uni.showModal({
						title: '无法访问相册',
						content: '《用户隐私保护指引》尚未配置或未生效，请在微信公众平台配置并等待审核通过后再试。',
						showCancel: false
					});
				} else {
					uni.showToast({ title: '选图失败，请重试', icon: 'none' });
				}
			}
		});
	}

	async function handlePublish() {
		if (publishing.value) return;
		if (!croppedPath.value) {
			return uni.showToast({ title: '请先选择图片', icon: 'none' });
		}
		// 发布时再校验一次登录态
		if (!requireLogin('/pages/Publish/publish')) return;

		const userInfo = getUserInfo();
		if (!userInfo || !userInfo._id) {
			return uni.showToast({ title: '登录信息异常，请重新登录', icon: 'none' });
		}

		publishing.value = true;
		uni.showLoading({ title: '发布中', mask: true });
		try {
			// 0. 兜底：真机调试通道单文件上限 2MB，超限直接拦截并给出明确提示
			const fileInfo = await new Promise((resolve) => {
				uni.getFileInfo({
					filePath: croppedPath.value,
					success: resolve,
					fail: () => resolve(null) // 取不到大小就放行，交给上传环节报错
				});
			});
			if (fileInfo && fileInfo.size > 1.9 * 1024 * 1024) {
				uni.hideLoading();
				return uni.showModal({
					title: '图片过大',
					content: '当前图片约 ' + (fileInfo.size / 1024 / 1024).toFixed(1) + 'MB，真机调试环境上限 2MB，请改用「预览」扫码上传，或重新裁剪一张画面更简单的图。',
					showCancel: false
				});
			}

			// 1. 裁剪后的图上传云存储
			const cloudPath = `wallpaper/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
			const upRes = await uniCloud.uploadFile({
				filePath: croppedPath.value,
				cloudPath
			});
			if (!upRes || !upRes.fileID) {
				throw new Error('图片上传失败');
			}

			// 2. 调用云函数落库（已包含封禁拦截、文本安全检测、author_id 归属强制写入）
			const desc = description.value.trim();
			const pubRes = await uniCloud.callFunction({
				name: 'wallpaper-action',
				data: {
					action: 'publish',
					image: upRes.fileID,
					description: desc,
					tags: selectedTags.value,
					width: cropWidth.value,
					height: cropHeight.value
				}
			});
			const pr = pubRes && pubRes.result;
			if (pr && pr.errCode !== 0) {
				uni.hideLoading();
				uni.showToast({ title: pr.errMsg || '发布失败', icon: 'none' });
				return;
			}

			uni.showToast({ title: '已提交，审核通过后展示', icon: 'none', duration: 1500 });
				// 通知首页强制刷新（首页有30s缓存，发布成功需立即过期）
				uni.$emit('wallpaperPublished');
				// 重置表单，供继续发布
				croppedPath.value = '';
				cropWidth.value = 0;
				cropHeight.value = 0;
				description.value = '';
				selectedTags.value = [];
				// 尝试请求审核结果通知的微信订阅授权（静默，失败不影响主流程）
				requestAuditSubscribe();
				setTimeout(() => {
					uni.switchTab({ url: '/pages/Home/index' });
				}, 1500);
		} catch (e) {
			uni.showToast({ title: (e && e.message) || '发布失败，请重试', icon: 'none' });
		} finally {
			publishing.value = false;
			uni.hideLoading();
		}
	}

	/**
	 * 发布成功后请求「审核结果通知」微信订阅授权。
	 * 先从云函数取 auditTemplateId（未配置则跳过），授权成功则攒一次下发额度。
	 * 全程静默：拒绝/失败均不提示、不影响发布主流程。
	 */
	async function requestAuditSubscribe() {
		// #ifdef MP-WEIXIN
		try {
			const infoRes = await uniCloud.callFunction({
				name: 'wallpaper-action',
				data: { action: 'subscribeInfo' }
			});
			const auditTemplateId = infoRes && infoRes.result && infoRes.result.auditTemplateId;
			if (!auditTemplateId) return; // 服务端未配置审核模板，跳过
			uni.requestSubscribeMessage({
				tmplIds: [auditTemplateId],
				success: (res) => {
					// accept 才攒额度
					if (res && res[auditTemplateId] === 'accept') {
						uniCloud.callFunction({
							name: 'wallpaper-action',
							data: { action: 'saveSubscribe', tmplType: 'audit' }
						});
					}
				},
				fail: () => {}
			});
		} catch (e) {}
		// #endif
	}
</script>

<style lang="scss">
	.publish-page {
		min-height: 100vh;
		background: #f5f7fa;
		padding: 30rpx;
		box-sizing: border-box;
	}

	.image-box {
		position: relative;
		width: 562rpx; // 空态默认框（375:400 接近比例）
		height: 600rpx;
		margin: 10rpx auto 30rpx;
		border-radius: 20rpx;
		overflow: hidden;
		background: #fff;
		border: 2rpx dashed #b9d4ea;
		display: flex;
		align-items: center;
		justify-content: center;

		// 有预览图时：内联宽高已按真实比例覆盖，边框改实线
		&.is-preview {
			border-style: solid;
			border-color: #d8e8f6;
		}

		.preview {
			width: 100%;
			height: 100%;
		}

		.placeholder {
			display: flex;
			flex-direction: column;
			align-items: center;

			.ph-title {
				margin-top: 20rpx;
				font-size: 32rpx;
				color: #1d6fb8;
				font-weight: bold;
			}

			.ph-tip {
				margin-top: 12rpx;
				font-size: 24rpx;
				color: #7fa9c9;
			}

			.ph-size {
				margin-top: 6rpx;
				font-size: 22rpx;
				color: #a7bfd3;
			}
		}

		.reselect {
			position: absolute;
			right: 0;
			bottom: 0;
			left: 0;
			height: 64rpx;
			background: rgba(0, 0, 0, 0.45);
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 8rpx;
			font-size: 24rpx;
			color: #fff;
		}
	}

	.form-card {
		position: relative;
		background: #fff;
		border-radius: 20rpx;
		padding: 28rpx 30rpx 44rpx;

		&.tags-card {
			padding: 24rpx 30rpx;
			margin-bottom: 24rpx;

			.tag-title {
				font-size: 26rpx;
				color: #7fa9c9;
				margin-bottom: 16rpx;
			}

			.tag-list {
				display: flex;
				flex-wrap: wrap;

				.tag-chip {
					padding: 10rpx 30rpx;
					margin: 0 16rpx 16rpx 0;
					border-radius: 32rpx;
					background: #f2f5f8;
					font-size: 24rpx;
					color: #4a5868;

					&.active {
						background: linear-gradient(90deg, #4facfe 0%, #2c98e7 100%);
						color: #fff;
					}
				}
			}
		}

		.desc-input {
			width: 100%;
			min-height: 120rpx;
			font-size: 28rpx;
			color: #333;
			line-height: 1.6;
			box-sizing: border-box;
		}

		.input-placeholder {
			color: #a7bfd3;
		}

		.word-count {
			position: absolute;
			right: 24rpx;
			bottom: 14rpx;
			font-size: 22rpx;
			color: #b5c8d8;
		}
	}

	.submit-btn {
		margin-top: 60rpx;
		height: 92rpx;
		line-height: 92rpx;
		border-radius: 46rpx;
		background: linear-gradient(90deg, #4facfe 0%, #2c98e7 100%);
		color: #fff;
		font-size: 32rpx;
		font-weight: bold;

		&::after {
			border: none;
		}

		&.disabled {
			opacity: 0.55;
		}
	}
</style>
