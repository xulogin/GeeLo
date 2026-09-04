/**
 * GeeLo · 在任意文件夹开一个 GEE 工作区
 * ============================================================================
 * 解决的问题：GeeLo 要保持干净稳定，但活得在别处干（那边有你的数据和资料）。
 *
 * 做法：不复制 GeeLo，只在目标文件夹里放三份很短的"指路牌"
 *      （AGENTS.md / CLAUDE.md / GEMINI.md），里面写死 GeeLo 的**绝对路径**。
 *      这样你在那个文件夹开任何 AI 助手，它一上来就知道工具在哪、规矩是什么，
 *      而 GeeLo 目录一个字都不会被改。
 *
 * ★ 为什么要三份：各家 AI 认的文件名不一样。
 *      AGENTS.md  → Codex / Cursor / Copilot / Cline / 通义灵码…（跨厂商约定）
 *      CLAUDE.md  → Claude Code
 *      GEMINI.md  → Gemini CLI
 *   内容主体只写在 AGENTS.md 里，另两份是短桩，指回它——**指路，不要复制**，
 *   否则规矩改了以后三份会各说各的。
 *
 * 用法：
 *   node new-workspace.js "D:\某个项目文件夹"
 *   或者把文件夹直接拖到《新建工作区.bat》上
 */
'use strict';

const fs = require('fs');
const path = require('path');

const TOOLBOX = __dirname;

function say(s) { process.stdout.write(s + '\n'); }

const target = process.argv.slice(2).filter(a => a.indexOf('--') !== 0)[0];
const force = process.argv.indexOf('--force') >= 0;

if (!target) {
  say('');
  say('用法：node new-workspace.js "D:\\某个项目文件夹"');
  say('      （也可以把文件夹拖到《新建工作区.bat》上）');
  say('');
  process.exit(1);
}

const dir = path.resolve(target);
if (!fs.existsSync(dir)) {
  say('');
  say('✗ 文件夹不存在：' + dir);
  say('');
  say('  先建好这个文件夹，或者换一个已存在的。');
  say('');
  process.exit(1);
}
if (!fs.statSync(dir).isDirectory()) {
  say('');
  say('✗ 这不是文件夹：' + dir);
  say('');
  process.exit(1);
}
// ★ 这一道拦截很要紧：人很自然会把 GeeLo 自己拖上去试一下。
//   不拦的话会覆盖掉权威版的 AGENTS.md —— 那是灾难性的，所有工作区都指向它。
if (path.resolve(dir) === path.resolve(TOOLBOX)) {
  say('');
  say('✗ 目标就是 GeeLo 目录本身。');
  say('');
  say('  GeeLo 自己已经有 AGENTS.md 了，不用再建。');
  say('  这个命令是给**别的**工作文件夹用的。');
  say('');
  process.exit(1);
}

// ---------------------------------------------------------------- 生成内容
// ★ 只写「路径 + 最要紧的几条」，详细规矩一律指回 GeeLo 的 AGENTS.md。
//   不在这里复制一份，否则两处会慢慢漂移——GeeLo 更新了，工作区还是老规矩。
const bench = path.join(TOOLBOX, '测试台', '跑GEE.js');
const brief = path.join(TOOLBOX, 'AGENTS.md');
const opener = path.join(TOOLBOX, '送进编辑器', 'gee-open.js');
const openerCfg = path.join(TOOLBOX, '送进编辑器', '配置.json');

// 功能二是可选的。没配置过就**不要**在指路牌里写推送流程——
// 写了 AI 就会去跑，然后撞上一句它无从处理的"还没设置过"。
const hasOpener = fs.existsSync(openerCfg);

const body = [
  '# 这个目录是一个 GeeLo 工作区',
  '',
  '**活在这里干；工具在别处，别去改它。**',
  '',
  '## GeeLo 位置',
  '',
  '```',
  TOOLBOX,
  '```',
  '',
  '## ★ 第一件事：读 GeeLo 的完整说明',
  '',
  '@' + brief,
  '',
  '（`@` 开头那行是 Claude Code 的自动导入语法，别的工具不认。',
  '如果它没有被自动加载，就**直接打开读**这个文件：',
  '`' + brief + '`',
  '那份文件写了两个功能是什么、以及八条铁律，不到 200 行，读完再动手。）',
  '',
  '## 最要紧的两条，先记住',
  '',
  '万一上面那份没读到，这两条也必须遵守：',
  '',
  '**一、写完 GEE 脚本必须实跑验证**，不许只静态审读就说"应该没问题"：',
  '',
  '```',
  'node "' + bench + '" --timeout 900 "<本目录里的脚本.js>"',
  '```',
  '',
  '**二、「跑通」不等于「对」**——GEE 是惰性计算，零报错也可能结果全错。',
  '跑完还要看数值合不合理、量级对不对、符号对不对。',
  '',
  '## 本工作区的约定',
  '',
  '- 成果脚本放本目录（或本目录的 `脚本\\`），一个成果一个文件',
  '- 探针、临时脚本放临时目录，**不要留在这里**',
  '- 数据和资料是本目录原有的，**不要动、不要重命名**',
  ''
].concat(hasOpener ? [
  '## ★ 调通之后，你自己把它送进 Code Editor（不用用户动手）',
  '',
  '```',
  ':: 中间迭代：只推送，不弹浏览器',
  'node "' + opener + '" "<脚本.js>" --no-browser',
  '',
  ':: 最终版：真开浏览器，让用户直接看到',
  'node "' + opener + '" "<脚本.js>"',
  '```',
  '',
  '规矩四条：',
  '',
  '1. **必须先在测试台跑通、且数值检查通过**才允许推送（跑通≠对）',
  '2. 迭代中一律加 `--no-browser`，只有最终那次才开浏览器',
  '3. 一个成果**只推最终版一次**——推送会在用户 EE 仓库造提交，推五次就是五个提交',
  '4. 推完要在回复里明说「已推送、标签页已打开」，不要悄悄做掉',
  '',
  '（用户自己右键 `.js` →「以 GEE 打开」的方式依然可用，这只是多一条路径。）',
  ''
] : [
  '## 关于「送进 Code Editor」',
  '',
  '这台机器**没有配置** GeeLo 的功能二（送进编辑器），所以**不要**尝试推送。',
  '脚本调通之后，把文件路径告诉用户即可。',
  '',
  '（用户想启用的话，见 `' + path.join(TOOLBOX, 'README.md') + '` 第 5.2 节。）',
  ''
]).join('\n');

/** 给不认 @import 的工具用的短桩：只说去读哪份，不复制内容 */
function stub(who) {
  return [
    '# 这个目录是一个 GeeLo 工作区',
    '',
    '**' + who + '：请先读同目录的 `AGENTS.md`**，那份写了 GeeLo 在哪、规矩是什么。',
    '',
    '它会把你指向 GeeLo 的完整说明：',
    '',
    '```',
    brief,
    '```',
    '',
    '最要紧的两条先记住：',
    '',
    '1. 写完 GEE 脚本**必须实跑验证**再交付：',
    '   `node "' + bench + '" --timeout 900 "<脚本.js>"`',
    '2. **「跑通」不等于「对」**——GEE 是惰性计算，零报错也可能结果全错。',
    ''
  ].join('\n');
}

// ---------------------------------------------------------------- 写出
const targets = [
  { name: 'AGENTS.md', text: body },                       // ★ 主体在这一份
  { name: 'CLAUDE.md', text: stub('Claude Code') },
  { name: 'GEMINI.md', text: stub('Gemini CLI') }
];

say('');
say('在这里开工作区：' + dir);
say('GeeLo：       ' + TOOLBOX);
say('送进编辑器：  ' + (hasOpener ? '已配置，指路牌里会写上推送流程'
                                  : '未配置，指路牌里会明确告诉 AI 不要推送'));
say('');

let wrote = 0, skipped = 0;
for (const t of targets) {
  const p = path.join(dir, t.name);
  if (fs.existsSync(p) && !force) {
    say('  [跳过] ' + t.name + ' 已存在（想覆盖就加 --force）');
    skipped++;
    continue;
  }
  fs.writeFileSync(p, t.text, 'utf8');   // UTF-8 无 BOM
  say('  [写入] ' + t.name);
  wrote++;
}

say('');
if (wrote) {
  say('✓ 好了。以后在这个文件夹开 AI 助手（Claude Code / Codex / Cursor /');
  say('  Gemini CLI / Copilot 都行），它自己就知道 GeeLo 在哪、规矩是什么，');
  say('  你直接提需求即可，不用再交代背景。');
} else {
  say('（' + skipped + ' 个文件都已存在，什么都没改。）');
}
say('');
// ★ 已知局限要写在**输出里**，不要只写在文档里 —— 人不会去翻文档。
say('★ 注意：里面写的是**绝对路径**。GeeLo 以后挪了位置，');
say('  在每个工作区重跑一次本命令即可（加 --force 覆盖）。');
say('');
