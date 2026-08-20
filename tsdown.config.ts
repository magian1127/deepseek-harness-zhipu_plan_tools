import type { UserConfig } from 'tsdown'

// 两个构建:
// 1) client:src/client.ts → lib/client.js,DSH 浏览器经典脚本
//    (window.__ModuleLoader__ 工厂;react 保持外部 require,不进 bundle)。
// 2) index:src/index.ts → lib/index.js,host 侧**单文件 ESM bundle**。
//    单文件是热挂载的关键:query URL(?v=N)只让入口 miss ESM 缓存,
//    多模块包的相对依赖会命中旧缓存(实测踩坑);bundle 成单文件后
//    query URL 即可完整控制模块版本。tsc 仍负责类型与声明文件。
const config: UserConfig[] = [
  {
    entry: { client: 'src/client.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    sourcemap: false,
    clean: false,
    deps: { neverBundle: ['react'] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: "window.__ModuleLoader__.load({ id: 'deepseek-harness-zhipu_plan_tools', factory: (require) => {",
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'node20',
    dts: false,
    sourcemap: false,
    clean: false,
    outputOptions: {
      entryFileNames: 'index.js',
    },
  },
]

export default config
