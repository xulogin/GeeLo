/**
 * GeeLo · 全局安装（给没有插件系统的 AI 工具用）
 * ============================================================================
 * 解决的问题：Claude Code 和 Codex 都有插件市场，两条命令就装好，任意文件夹随开随用。
 *            但 Gemini CLI / Cursor / Cline 没有这套东西——它们只有"全局指令文件"
 *            或"全局规则设置"。这个脚本就是把指路牌装进那些地方。
 *
 * ★ 装的是「指路牌」不是「内容」——只写 GeeLo 的绝对路径 + 最要紧的两条铁律，
 *   详细规矩一律指回 GeeLo\AGENTS.md。理由见 文档\设计笔记_上下文注入.md 第四节：
 *   复制就会漂移。
 *
 * ★ 指路牌必须**极短**。全局指令文件是**每次会话都加载**的，不像 skill 那样
 *   说到 GEE 才展开。写长了，你用 Gemini 写任何无关代码都要背着这一段。
 *
 * 用法：
 *   node 全局安装.js           检测已装的工具，逐个装上指路牌
 *   node 全局安装.js --卸载    移除（只删本脚本写的标记块，不碰你自己写的内容）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const TOOLBOX = __dirname;
const HOME = os.homedir();
const 卸载 = process.argv.includes('--卸载') || process.argv.includes('--uninstall');

function say(s) { process.stdout.write(s + '\n'); }

// ★ 用标记块把"我们写的"和"用户自己写的"隔开。
//   重跑只替换块内内容，块外的东西一个字不动——这样反复运行是安全的。
const 开始标记 = '<!-- GeeLo:begin 本段由 全局安装.js 生成，重跑会覆盖；你自己的内容写在标记外面 -->';
const 结束标记 = '<!-- GeeLo:end -->';

const 跑GEE = path.join(TOOLBOX, '测试台', '跑GEE.js');
const 权威说明 = path.join(TOOLBOX, 'AGENTS.md');

// ---------------------------------------------------------------- 指路牌内容
// 短。每次会话都要加载的东西，长度就是成本。
const 指路牌 = [
  开始标记,
  '',
  '## GeeLo —— 写 Google Earth Engine 脚本时用',
  '',
  '工具在 `' + TOOLBOX + '`，完整规矩见 `' + 权威说明 + '`。',
  '',
  '两条不能违反的：',
  '',
  '1. **写完 GEE 脚本必须实跑验证再交付**，不许只静态审读：',
  '   `node "' + 跑GEE + '" --timeout 900 "<脚本.js>"`',
  '2. **「跑通」不等于「对」**——GEE 是惰性计算，零报错也可能结果全错。',
  '   跑完还要看数值合不合理、量级对不对、符号对不对。',
  '',
  '不写 GEE 脚本时，忽略本节。',
  '',
  结束标记,
].join('\n');

// Gemini CLI 的自定义命令（TOML）。装完就有 /geelo。
const geeloTOML = [
  '# 由 GeeLo 全局安装.js 生成 —— 删掉本文件即可移除 /geelo',
  'description = "写/调试 GEE 脚本。带需求直接开工，不带参数就跑环境自检。"',
  '',
  'prompt = """',
  '你现在要用 GeeLo 干活。工具在 ' + TOOLBOX + '。',
  '**先读 ' + 权威说明 + '**，按里面的铁律执行。',
  '',
  '用户输入：{{args}}',
  '',
  '## 输入为空时',
  '跑一次环境自检，用大白话告诉用户现在能不能干活、缺什么、怎么补：',
  '  node "' + path.join(TOOLBOX, '测试台', '环境自检.js') + '"',
  '别把原始输出整段糊给用户，挑出他要做的事说。',
  '缺凭据或项目 ID 就跑 node "' + path.join(TOOLBOX, '测试台', '认证.js') + '"，',
  '它会自动开浏览器，让用户点一下「允许」就配好，不用装 Python。',
  '**不要让他把凭据内容贴给你**。',
  '',
  '## 输入不为空时 —— 那就是需求，直接开工',
  '1. 写完必须实跑验证：node "' + 跑GEE + '" --timeout 900 "<脚本>"',
  '   没跑过的脚本不算交付。',
  '2. 跑通不等于对：跑完再看一层数值——量级对吗、符号对吗、讲得通吗。',
  '3. 先小后大：Debug 阶段先拿一小块区域、一个时间段试，通了再放大，省用户配额。',
  '',
  '成果脚本写到当前工作目录，探针和临时脚本写到临时目录。',
  '交付时附上实跑输出当证据；跑不通就说跑不通。',
  '"""',
  '',
].join('\n');

// ---------------------------------------------------------------- 写文件
/** 把指路牌写进（或从）一个 Markdown 指令文件。已有标记块就替换，没有就追加。 */
function 装指路牌(文件) {
  const 目录 = path.dirname(文件);
  if (!fs.existsSync(目录)) { return { 状态: '跳过', 说明: '目录不存在：' + 目录 }; }

  let 原文 = fs.existsSync(文件) ? fs.readFileSync(文件, 'utf8') : '';
  const 开始 = 原文.indexOf(开始标记);
  const 结束 = 原文.indexOf(结束标记);

  if (卸载) {
    if (开始 < 0) { return { 状态: '跳过', 说明: '本来就没装' }; }
    const 新文 = (原文.slice(0, 开始) + 原文.slice(结束 + 结束标记.length)).replace(/\n{3,}/g, '\n\n').trim();
    // 整个文件只剩我们那一段的话，直接删掉文件，别留个空壳
    if (新文 === '') { fs.unlinkSync(文件); return { 状态: '已移除', 说明: '文件已空，一并删除' }; }
    fs.writeFileSync(文件, 新文 + '\n', 'utf8');
    return { 状态: '已移除', 说明: '你自己写的内容原样保留' };
  }

  if (开始 >= 0 && 结束 > 开始) {
    const 新文 = 原文.slice(0, 开始) + 指路牌 + 原文.slice(结束 + 结束标记.length);
    fs.writeFileSync(文件, 新文, 'utf8');
    return { 状态: '已更新', 说明: '替换了原有的 GeeLo 段落' };
  }

  const 新文 = (原文.trim() ? 原文.trim() + '\n\n' : '') + 指路牌 + '\n';
  fs.writeFileSync(文件, 新文, 'utf8');
  return { 状态: 原文.trim() ? '已追加' : '已创建', 说明: 文件 };
}

/** 写 Gemini 的 /geelo 命令文件。 */
function 装Gemini命令() {
  const 目录 = path.join(HOME, '.gemini', 'commands');
  const 文件 = path.join(目录, 'geelo.toml');
  if (卸载) {
    if (!fs.existsSync(文件)) { return { 状态: '跳过', 说明: '本来就没装' }; }
    fs.unlinkSync(文件);
    return { 状态: '已移除', 说明: 文件 };
  }
  if (!fs.existsSync(path.join(HOME, '.gemini'))) {
    return { 状态: '跳过', 说明: '没找到 ~/.gemini（没装 Gemini CLI）' };
  }
  fs.mkdirSync(目录, { recursive: true });
  fs.writeFileSync(文件, geeloTOML, 'utf8');
  return { 状态: '已写入', 说明: 文件 };
}

// ---------------------------------------------------------------- 主流程
say('');
say('══════════════════════════════════════════════════════════════');
say('  GeeLo · 全局安装' + (卸载 ? '（卸载模式）' : ''));
say('══════════════════════════════════════════════════════════════');
say('');
say('  工具目录：' + TOOLBOX);
say('');

// ---- Claude Code 与 Codex：有插件系统，走那条更好的路，这里不写任何文件
say('【Claude Code / Codex】');
say('──────────────────────────────────────────────────────────────');
say('  这两家有插件市场，**不用本脚本**——两条命令更干净：');
say('');
say('    Claude Code:  /plugin marketplace add https://github.com/xulogin/GeeLo.git');
say('                  /plugin install geelo@geelo');
say('');
say('    Codex:        codex plugin marketplace add https://github.com/xulogin/GeeLo.git');
say('                  codex plugin add geelo@geelo');
say('');
say('  ★ 装了插件就别再用本脚本给它们写全局指路牌，会重复占上下文。');
say('');

// ---- Gemini CLI
say('【Gemini CLI】');
say('──────────────────────────────────────────────────────────────');
const g1 = 装指路牌(path.join(HOME, '.gemini', 'GEMINI.md'));
say('  指路牌　' + g1.状态 + '　' + g1.说明);
const g2 = 装Gemini命令();
say('  /geelo 命令　' + g2.状态 + '　' + g2.说明);
say('');

// ---- Cursor / Cline：只能手动，给一段可直接粘贴的
if (!卸载) {
  say('【Cursor / Cline / 其他没有全局指令文件的工具】');
  say('──────────────────────────────────────────────────────────────');
  say('  这些工具的全局规则在**设置界面**里，脚本改不了。');
  say('  把下面这段整个复制，粘进它们的 Global Rules / Custom Instructions：');
  say('');
  say('  ┌──────────────────────────────────────────────────────────');
  指路牌.split('\n').forEach(l => {
    if (l === 开始标记 || l === 结束标记) { return; }   // 标记是给脚本认的，人不用粘
    say('  │ ' + l);
  });
  say('  └──────────────────────────────────────────────────────────');
  say('');
}

say('══════════════════════════════════════════════════════════════');
if (卸载) {
  say('  卸载完成。你自己写在标记块外面的内容都没动。');
} else {
  say('  装完了。之后在**任意文件夹**开这些工具，它一上来就知道 GeeLo 在哪。');
  say('');
  say('  ★ 写进去的是**绝对路径**。GeeLo 以后挪了位置，重跑一次本脚本即可。');
  say('  ★ 要移除：node "' + path.join(TOOLBOX, '全局安装.js') + '" --卸载');
}
say('══════════════════════════════════════════════════════════════');
say('');
