'use strict';
const { getAppConfig } = require('../common/wx');

/* ========== App 热更新检测：返回 config.json app 节点（versionCode/wgtUrl/apkUrl/updateNotes） ========== */
async function checkUpdate(ctx) {
	return { errCode: 0, app: getAppConfig() };
}

module.exports = { checkUpdate };
