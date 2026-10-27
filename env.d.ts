// 全局类型声明（TypeScript）
// uni / uniCloud 等 API 类型由 tsconfig.json 的 types: ["@dcloudio/types"] 提供

// Vue SFC 模块声明：TS 文件中 import *.vue 时使用
declare module '*.vue' {
	import type { DefineComponent } from 'vue';
	const component: DefineComponent<Record<string, any>, Record<string, any>, any>;
	export default component;
}
