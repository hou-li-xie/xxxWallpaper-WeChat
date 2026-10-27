/**
 * 云存储 fileID -> 可访问的 https 临时 URL
 *
 * 背景：头像/图片上传后拿到的是 cloud:// 开头的 fileID，
 * 微信小程序的 image 组件无法直接渲染 uniCloud 的 cloud:// 地址，
 * 必须通过 uniCloud.getTempFileURL 换取临时 https 地址。
 */

interface CachedUrl {
	url: string;
	expire: number;
}

interface TempFileItem {
	fileID?: string;
	tempFileURL?: string;
	code?: string;
}

const CACHE_PREFIX = 'cloud_file_url_';
// 临时 URL 默认约 2 小时有效，本地缓存 100 分钟，过期自动重新换取
const CACHE_TTL = 100 * 60 * 1000;
// 缓存条数上限：超出后按过期时间淘汰最旧的，避免长期占用小程序 storage
const CACHE_MAX = 200;
const CACHE_INDEX_KEY = 'cloud_file_url_index_v1';
// 批量换链接时每批条数，单批失败不影响其他批次
const FETCH_CHUNK = 50;
// 同一 fileID 并发请求去重
const pendingMap = new Map<string, Promise<string>>();

interface CacheIndexItem {
	id: string;
	expire: number;
}

export function isCloudFileID(url: unknown): boolean {
	return typeof url === 'string' && url.indexOf('cloud://') === 0;
}

function readCache(fileID: string): string {
	try {
		const cached = uni.getStorageSync(CACHE_PREFIX + fileID) as CachedUrl | '';
		if (cached && cached.url && cached.expire > Date.now()) {
			return cached.url;
		}
	} catch (e) {
		// 缓存读取失败忽略
	}
	return '';
}

function readIndex(): CacheIndexItem[] {
	try {
		const raw = uni.getStorageSync(CACHE_INDEX_KEY);
		return Array.isArray(raw) ? raw : [];
	} catch (e) {
		return [];
	}
}

function writeCache(fileID: string, url: string): void {
	const expire = Date.now() + CACHE_TTL;
	try {
		uni.setStorageSync(CACHE_PREFIX + fileID, { url, expire } as CachedUrl);
		// 维护索引：去掉同一 fileID 的旧记录与已过期项，再按上限淘汰
		let index = readIndex().filter((item) => item && item.expire > Date.now() && item.id !== fileID);
		index.push({ id: fileID, expire });
		index.sort((a, b) => b.expire - a.expire);
		if (index.length > CACHE_MAX) {
			index.slice(CACHE_MAX).forEach((item) => {
				try {
					uni.removeStorageSync(CACHE_PREFIX + item.id);
				} catch (e) {}
			});
			index = index.slice(0, CACHE_MAX);
		}
		uni.setStorageSync(CACHE_INDEX_KEY, index);
	} catch (e) {
		// 缓存写入失败忽略
	}
}

/**
 * 单个 fileID 转临时 URL；传入 http(s) 直链时原样返回
 */
export function resolveFileUrl(fileID: string): Promise<string> {
	if (!fileID) return Promise.resolve('');
	if (!isCloudFileID(fileID)) return Promise.resolve(fileID);

	const cached = readCache(fileID);
	if (cached) return Promise.resolve(cached);

	if (pendingMap.has(fileID)) return pendingMap.get(fileID)!;

	const task = uniCloud
		.getTempFileURL({ fileList: [fileID] })
		.then((res: any) => {
			const item: TempFileItem | undefined = res && res.fileList && res.fileList[0];
			const url = item && item.tempFileURL;
			if (!url) throw new Error(item && item.code ? 'code:' + item.code : '获取文件地址失败');
			writeCache(fileID, url);
			return url;
		})
		.finally(() => {
			pendingMap.delete(fileID);
		});

	pendingMap.set(fileID, task);
	return task;
}

/**
 * 批量转换（图片列表页使用）
 * @returns { [fileID]: url }
 */
export async function resolveFileUrls(fileIDs: string[]): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	const needFetch: string[] = [];

	(fileIDs || []).forEach((id) => {
		if (!id) return;
		if (!isCloudFileID(id)) {
			result[id] = id;
			return;
		}
		const cached = readCache(id);
		if (cached) {
			result[id] = cached;
		} else if (needFetch.indexOf(id) === -1) {
			needFetch.push(id);
		}
	});

	if (needFetch.length) {
		// 分批请求：某批失败只影响该批，其他批次仍能拿到地址
		for (let i = 0; i < needFetch.length; i += FETCH_CHUNK) {
			const chunk = needFetch.slice(i, i + FETCH_CHUNK);
			try {
				const res = await uniCloud.getTempFileURL({ fileList: chunk });
				((res && res.fileList) || []).forEach((item: TempFileItem) => {
					if (item && item.tempFileURL && item.fileID) {
						writeCache(item.fileID, item.tempFileURL);
						result[item.fileID] = item.tempFileURL;
					}
				});
			} catch (e) {
				console.error('[cloud-file] 批量换取临时地址失败', e);
			}
		}
	}

	return result;
}
