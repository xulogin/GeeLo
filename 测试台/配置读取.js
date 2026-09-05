/**
 * GeeLo · 配置读取 —— 跑GEE.js 与 环境自检.js **共用同一份**
 * ============================================================================
 * 为什么单独抽出来：以前两个文件各抄了一份解析逻辑，结果解析规则不一致，
 * 出现过"自检说没配置、跑GEE 却读得到"的怪事。共用一份就不会漂。
 *
 * 配置.txt 是 GBK 编码（Windows 记事本默认存的就是这个），
 * 但项目 ID 只会是 ASCII，所以整体按 latin1 读字节再取值——
 * 中文注释乱不乱码都不影响解析。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CFG_NAME = '配置.txt';

// ★ 键名判据只认 **ASCII** 部分。
//   「项目ID」里的中文按 GBK 存是 CF EE C4 BF，按 UTF-8 存又是另一串字节，
//   靠中文字节去匹配，等于赌文件用哪种编码存——不可靠（我一开始就推错过一次）。
//   而 "ID" 这两个字母无论 GBK 还是 UTF-8 都原样是 0x49 0x44，永远认得出来。
const KEY_PATTERNS = [
  /ID\s*(?:=|:|£½|£º|＝|：)/i,   // 「项目ID＝」「PROJECT ID:」…
  /\bPROJECT\b/i,
  /\bEE_PROJECT\b/i,
];

/**
 * 读项目 ID。
 * 顺序：环境变量 EE_PROJECT → 同目录 配置.txt → 默认值。
 * @returns {{value:string, from:string, warn:string|null}}
 */
// ★ 仓库里发出去的 配置.txt 写的就是这个占位符。它**不是**一个真实项目。
//   单独拎出来做常量，是为了能在解析成功之后再判一次「你还没改」——
//   否则它会一路顺利解析出来、显示 [通过]，直到最后一步才报"项目没注册"，
//   而那句报错看起来像 GEE 的问题，不像"你忘了填配置"。
const PLACEHOLDER = 'ee-your-project-id';

// ★ 这里**首推环境变量，不要教人去改 配置.txt**。两个理由，都踩过：
//   ① 配置.txt 是 GBK 编码。别人用 PowerShell 按 ANSI 读写去改那一行，报过错；
//      改坏了还会把整份文件的中文注释变成乱码。
//   ② 装成插件时 配置.txt 在插件目录里，/plugin update 会把它整个冲掉。
//   认证.js --project=<id> 内部就是 setx，不碰任何文件，两个问题一起没有。
const PLACEHOLDER_WARN =
  '项目 ID 还是发布时的占位符「' + PLACEHOLDER + '」，**你还没填自己的**。\n'
  + '最省事的办法（不用编辑任何文件）：\n'
  + '  node "' + path.join(__dirname, '认证.js') + '" --project=<你的项目ID>\n'
  + '在哪看项目 ID：code.earthengine.google.com 右上角的项目选择器，'
  + '或 Assets 面板里 projects/<这里就是>/assets/…\n'
  + '（也可以自己 setx EE_PROJECT <项目ID>，效果一样，都要新开终端才生效。）';

function readProject(dir, fallback) {
  dir = dir || __dirname;
  fallback = fallback || PLACEHOLDER;

  if (process.env.EE_PROJECT) {
    return { value: process.env.EE_PROJECT, from: '环境变量 EE_PROJECT', warn: null };
  }

  const p = path.join(dir, CFG_NAME);
  if (!fs.existsSync(p)) {
    return { value: fallback, from: '内置占位符',
             warn: '找不到 ' + CFG_NAME + '。\n' + PLACEHOLDER_WARN };
  }

  let raw;
  try {
    raw = fs.readFileSync(p).toString('latin1');
  } catch (e) {
    return { value: fallback, from: '内置默认值',
             warn: CFG_NAME + ' 读不出来：' + e.message };
  }

  let sawKeyLine = false;
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) { continue; }                 // 注释行
    if (!KEY_PATTERNS.some(re => re.test(line))) { continue; }  // ★ 只认指定键名
    sawKeyLine = true;
    // 分隔符：半角 = :，以及**全角 ＝ ：**（GBK 里是双字节 A3BD / A3BA，
    // 按 latin1 读出来就是 £½ 和 £º）。
    // 中文输入法下打出全角是极常见的事，不认的话会静默回落，最难查。
    const m = line.match(/(?:=|:|£½|£º|＝|：)\s*([A-Za-z0-9][A-Za-z0-9_-]{2,})\s*$/);
    if (m) {
      // ★ 解析成功，但值还是占位符 —— 当成"没配置"报，别放行。
      return m[1] === PLACEHOLDER
        ? { value: m[1], from: CFG_NAME, warn: PLACEHOLDER_WARN }
        : { value: m[1], from: CFG_NAME, warn: null };
    }
  }

  return {
    value: fallback, from: '内置占位符',
    warn: sawKeyLine
      ? (CFG_NAME + ' 里有「项目ID」这一行，但**值没解析出来**。'
         + '常见原因：等号后面是空的，或者项目 ID 里有中文/空格。'
         + '正确写法举例：　项目ID = ee-yourname')
      : (CFG_NAME + ' 里没找到「项目ID = ...」这一行。\n' + PLACEHOLDER_WARN),
  };
}

/**
 * 读代理设置（可选）。配置.txt 里写「代理 = http://127.0.0.1:10808」就用它；
 * 不写或写「自动」就返回 null，交给 代理探测.js 自动找。
 * @returns {string|null}
 */
function readProxy(dir) {
  dir = dir || __dirname;
  const p = path.join(dir, CFG_NAME);
  if (!fs.existsSync(p)) { return null; }
  let raw;
  try { raw = fs.readFileSync(p).toString('latin1'); } catch (e) { return null; }
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) { continue; }
    // 认 ASCII 的 PROXY / http:// —— 不依赖「代理」两个中文字怎么编码
    if (!/PROXY/i.test(line) && !/https?:\/\//i.test(line)) { continue; }
    const m = line.match(/(https?:\/\/[A-Za-z0-9._-]+:\d{2,5})/i);
    if (m) { return m[1]; }
  }
  return null;
}

module.exports = { readProject, readProxy, CFG_NAME, PLACEHOLDER };
