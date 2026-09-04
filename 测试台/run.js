/**
 * GeeLo · ASCII 入口壳
 * ============================================================================
 * 存在的唯一理由：**.bat 里不能出现中文文件名。**
 *
 * cmd 按**当前控制台代码页**解析 .bat 的字节。同一份 GBK 字节，
 * 在 cp936 下解出「跑GEE.js」，在 cp65001 下就是乱码，于是：
 *
 *     Error: Cannot find module '...\??GEE.js'
 *
 * 双击运行（Explorer 用 cp936）看不出问题，从 UTF-8 终端调用就崩。
 *
 * 解法：.bat 只写 ASCII 的 `node run.js …`，中文文件名放进**这个 .js 里**——
 * Node 永远按 UTF-8 读源码，跟控制台代码页无关，怎么调都对。
 *
 * 用法（给 .bat 用，人不用直接敲）：
 *   node run.js check              → 环境自检.js
 *   node run.js demo               → 依次跑 示例\ 下的两个演示脚本
 *   node run.js bench <参数...>     → 跑GEE.js <参数...>
 *
 * ★ 注意 demo 为什么要单独做一条：不只是**文件名**不能出现在 .bat 里，
 *   **参数里的中文路径**同样会被代码页啃掉。所以演示脚本的路径也收进这里。
 *
 * ★ AI 直接跑脚本时不用经过这里，照常：
 *   node "…\测试台\跑GEE.js" --timeout 900 "<脚本.js>"
 */
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const MAP = {
  check: '环境自检.js',
  bench: '跑GEE.js'
};

const DEMOS = [
  '示例\\演示_这就是CodeEditor的JS.js',
  '示例\\演示_故意写错看它怎么报.js'
];

function call(script, args) {
  const r = spawnSync(
    process.execPath,
    [path.join(__dirname, script)].concat(args || []),
    { stdio: 'inherit' }
  );
  return r.status === null ? 1 : r.status;
}

const argv = process.argv.slice(2);
const cmd = argv[0];

if (cmd === 'demo') {
  // ★ 叙述文字放在这里而不是 .bat 里：Node 输出 UTF-8，配合 .bat 开头的
  //   chcp 65001，在任何代码页下都显示正常。写进 .bat 就会受代码页摆布。
  console.log('');
  console.log('============================================================');
  console.log('   GeeLo 测试台 · 演示');
  console.log('   跑的是 JavaScript（就是 Code Editor 那套），不是 Python');
  console.log('============================================================');
  console.log('');
  console.log('[1/2] 先跑一个正常脚本，看它真连服务器取回结果');
  call('跑GEE.js', [path.join(__dirname, DEMOS[0])]);

  console.log('');
  console.log('[2/2] 再跑一个故意写错的，看它怎么把错抓出来');
  // 这个演示**故意是错的**，报错才对，所以不把它的退出码算成失败
  call('跑GEE.js', [path.join(__dirname, DEMOS[1])]);

  console.log('');
  console.log('============================================================');
  console.log('   用法详见本目录的《说明.md》');
  console.log('============================================================');
  process.exit(0);
}

if (cmd === 'check') {
  console.log('');
  console.log('  正在检查环境，请稍候（要连一次 Google，约 10~30 秒）…');
  console.log('');
  process.exit(call('环境自检.js', argv.slice(1)));
}

const target = MAP[cmd];
if (!target) {
  console.log('');
  console.log('用法： node run.js check          跑环境自检');
  console.log('       node run.js demo           跑两个演示脚本');
  console.log('       node run.js bench <参数>   跑 GEE 脚本');
  console.log('');
  console.log('（这是给 .bat 用的 ASCII 入口壳，一般不用直接敲。）');
  console.log('');
  process.exit(1);
}

process.exit(call(target, argv.slice(1)));
