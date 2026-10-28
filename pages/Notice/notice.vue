<template>
	<view class="notice-page">
		<view class="notice-card">
			<view class="notice-title">公告与声明</view>

			<view class="notice-section">
				<view class="section-title">联系开发者</view>
				<view class="section-content">
					<text>如有问题或建议，欢迎联系：</text>
					<text class="contact-email" selectable>919255119@qq.com</text>
				</view>
			</view>

			<view class="notice-section">
				<view class="section-title">免责声明</view>
				<view class="section-content">
					<view class="para">1. 本小程序为照片分享社区，平台内所有照片均由用户自行上传发布，平台仅提供信息存储空间服务，不对用户发布内容的准确性、合法性负责。</view>
					<view class="para">2. 用户上传涉及他人肖像的照片前，须已取得肖像权人的明确授权。未经授权擅自上传他人照片的，一切法律责任由上传者本人承担，与平台无关。</view>
					<view class="para">3. 任何单位或个人认为平台内容侵犯其肖像权、著作权或其他合法权益的，请通过上方联系邮箱与平台联系并提供相关证明，平台核实后将第一时间删除相关内容。</view>
					<view class="para">4. 用户在使用本服务过程中，应遵守国家法律法规，不得上传、传播违法、低俗、暴力或其他违反公序良俗的内容，否则由此产生的一切后果由用户自行承担，平台并有权封禁相关账号。</view>
					<view class="para">5. 平台会尽力确保服务的稳定性和安全性，但对于因不可抗力、网络故障、第三方攻击等原因导致的服务中断或数据丢失，平台不承担赔偿责任。</view>
					<view class="para">6. 本免责声明的最终解释权归平台所有，平台有权根据运营需要对声明内容进行修改和更新。</view>
				</view>
			</view>

			<view class="notice-footer">
				<text>十月初美人鉴赏</text>
				<text class="footer-date">2026年10月</text>
			</view>
		</view>
	</view>
</template>

<script setup lang="ts">
</script>

<style lang="scss">
	.notice-page {
		min-height: 100vh;
		background: #f5f7fa;
		padding: 30rpx;
		box-sizing: border-box;
	}

	.notice-card {
		background: #fff;
		border-radius: 24rpx;
		padding: 40rpx 32rpx;
		box-shadow: 0 8rpx 24rpx rgba(0, 0, 0, 0.04);
	}

	.notice-title {
		font-size: 38rpx;
		font-weight: bold;
		color: #1d2b3a;
		text-align: center;
		margin-bottom: 40rpx;
	}

	.notice-section {
		margin-bottom: 36rpx;

		.section-title {
			font-size: 30rpx;
			font-weight: bold;
			color: #333;
			margin-bottom: 16rpx;
			padding-left: 16rpx;
			border-left: 6rpx solid #2c98e7;
		}

		.section-content {
			font-size: 27rpx;
			color: #5a6a7a;
			line-height: 1.8;

			.para {
				margin-bottom: 16rpx;
			}

			.contact-email {
				display: block;
				margin-top: 10rpx;
				font-size: 30rpx;
				color: #2c98e7;
				font-weight: bold;
			}
		}
	}

	.notice-footer {
		margin-top: 50rpx;
		padding-top: 30rpx;
		border-top: 1rpx solid #eef1f5;
		display: flex;
		flex-direction: column;
		align-items: center;
		font-size: 26rpx;
		color: #8a99a8;

		.footer-date {
			margin-top: 8rpx;
			font-size: 24rpx;
		}
	}
</style>