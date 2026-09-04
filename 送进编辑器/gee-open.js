/**
 * GeeLo · 送进编辑器 —— 把本地 .js 推进 EE 脚本仓库并打开 Code Editor
 * ============================================================================
 * 用法（★ 文件名必须是纯 ASCII，原因见《说明.md》坑 1）：
 *   node gee-open.js --setup           一次性设置（查 git、查凭据、发现仓库、克隆）
 *   node gee-open.js <某个脚本.js>      推送并用你平常的 Chrome 打开
 *   node gee-open.js --status          看当前配置
 *   node gee-open.js --register        往右键菜单加「以 GEE 打开」
 *
 * 原理一句话：Earth Engine 的脚本仓库就是 git 仓库（earthengine.googlesource.com），
 * Code Editor 支持用 ?scriptPath=<仓库>:<脚本名> 直接打开其中一个脚本。
 * 所以「把本地文件送进编辑器」= git push + 开一个 URL。全程用你已登录的 Chrome，
 * 不碰任何账号凭据，也不依赖页面结构（Google 改版不会失效）。
 * 详见同目录《说明.md》。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const TOOL_DIR = __dirname;
const CFG_PATH = path.join(TOOL_DIR, '配置.json');
// ★ 工作目录用**纯 ASCII** 名字：它会出现在报错信息、PowerShell 排错命令、
//   以及别人的截图里，中文目录名在不同代码页下显示成乱码，徒增沟通成本。
const WORK_DIR = path.join(process.env.LOCALAPPDATA || os.homedir(), 'GeeLo');
const REPO_DIR = path.join(WORK_DIR, 'repo');
const COOKIES = path.join(os.homedir(), '.gitcookies');
const GITILES = 'https://earthengine.googlesource.com';

// ----------------------------------------------------------------- 小工具
function say(s) { process.stdout.write(s + '\n'); }
function die(msg, hint) {
  say('');
  say('✗ ' + msg);
  if (hint) { say(''); say(hint); }
  say('');
  process.exit(1);
}

function run(cmd, args, opts) {
  // ★ maxBuffer 必须放大：仓库列表 JSON 有好几 MB，
  //   用默认值会直接 spawnSync ENOBUFS，而且报错信息完全看不出是缓冲区的事。
  const r = spawnSync(cmd, args, Object.assign({
    encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024
  }, opts || {}));
  return {
    code: r.status,
    out: (r.stdout || '').trim(),
    err: (r.error ? r.error.message : (r.stderr || '')).trim()
  };
}

/** 代理：优先 git 自己的 http.proxy（多半已配好），其次环境变量 */
function proxy() {
  const g = run('git', ['config', '--global', '--get', 'http.proxy']);
  if (g.code === 0 && g.out) return g.out;
  return process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
}

/** git 命令统一入口：带上代理与中文文件名设置 */
function git(args, cwd) {
  const base = ['-c', 'core.quotepath=false'];
  const p = proxy();
  if (p) base.push('-c', 'http.proxy=' + p);
  // 没配过身份的机器上 commit 会失败，这里兜底（不改动你的全局配置）
  const who = run('git', ['config', '--global', '--get', 'user.email']);
  if (!(who.code === 0 && who.out)) {
    base.push('-c', 'user.name=GEE Local', '-c', 'user.email=gee-local@example.invalid');
  }
  return run('git', base.concat(args), cwd ? { cwd: cwd } : {});
}

function findChrome() {
  const cands = [
    path.join(process.env['ProgramFiles'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['LOCALAPPDATA'] || '', 'Google\\Chrome\\Application\\chrome.exe')
  ];
  for (const c of cands) { if (c && fs.existsSync(c)) return c; }
  return null;
}

function openInChrome(url) {
  const chrome = findChrome();
  if (chrome) {
    // ★ 不给 --user-data-dir，用的就是你平常那个 profile，登录态原样在
    spawn(chrome, [url], { detached: true, stdio: 'ignore' }).unref();
    return '你的 Chrome';
  }
  spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  return '默认浏览器';
}

function loadCfg() {
  if (!fs.existsSync(CFG_PATH)) return null;
  let raw;
  try { raw = fs.readFileSync(CFG_PATH, 'utf8'); } catch (e) { return null; }
  // ★ 去 BOM：用记事本或 PowerShell 的 Set-Content -Encoding UTF8 存过的话会带 BOM，
  //   JSON.parse 见到 BOM 直接抛异常，然后被报成「还没设置过」，极具误导性。
  raw = raw.replace(/^﻿/, '');
  try { return JSON.parse(raw); }
  catch (e) {
    die('配置.json 读不动：' + e.message,
      '删掉本目录的 配置.json，重跑《设置.bat》重新生成。');
  }
}

// ----------------------------------------------------------------- 设置
function haveCookies() {
  if (!fs.existsSync(COOKIES)) return false;
  const t = fs.readFileSync(COOKIES, 'utf8');
  return /earthengine\.googlesource\.com|\.googlesource\.com/.test(t);
}

/**
 * 从 .gitcookies 里解出 EE 用户名。
 * cookie 名字形如 git-<用户名>.gmail.com=…，中间那段就是 EE 用户名。
 * ★ 为什么需要它：/?format=JSON 返回的是**全服务器**三万多个仓库（不是你的），
 *   必须靠用户名过滤才能挑出你自己的。
 */
function accountFromCookies() {
  if (!fs.existsSync(COOKIES)) return null;
  const t = fs.readFileSync(COOKIES, 'utf8');
  const m = t.match(/\bgit-([A-Za-z0-9_.+-]+?)\.[A-Za-z0-9-]+\.[A-Za-z]{2,}=/);
  return m ? m[1] : null;
}

/** 用 curl 带上 .gitcookies 去问服务器「我有哪些仓库」 */
function discoverRepos() {
  const args = ['-s', '-b', COOKIES, '-w', '\n__HTTP__%{http_code}'];
  const p = proxy();
  if (p) args.push('--proxy', p);
  args.push(GITILES + '/?format=JSON');

  const r = run('curl.exe', args);
  // ★ 区分「curl 自己跑不起来」和「服务器拒绝」——两者处置方式完全不同，
  //   一开始把前者也报成「凭据过期」，白折腾。
  if (r.code !== 0) {
    return { fatal: 'curl 没能跑完：' + (r.err || ('退出码 ' + r.code)) };
  }

  const m = r.out.match(/__HTTP__(\d+)\s*$/);
  const status = m ? m[1] : '?';
  let body = r.out.replace(/\n?__HTTP__\d+\s*$/, '');

  if (status === '401' || status === '403') {
    return { error: '服务器返回 ' + status + '（未认证）—— .gitcookies 无效或已过期' };
  }
  if (status !== '200') return { error: '服务器返回 ' + status + '：' + body.slice(0, 200) };

  // Gitiles 的 JSON 前面有一行防 XSSI 的 )]}' ，要先切掉
  body = body.replace(/^\)\]\}'\s*/, '');
  let obj;
  try { obj = JSON.parse(body); } catch (e) { return { error: 'JSON 解析失败：' + body.slice(0, 200) }; }
  return { repos: Object.keys(obj) };
}

function setup(argv) {
  say('');
  say('GeeLo · 送进编辑器 · 设置');
  say('='.repeat(60));

  // 1. git
  const g = run('git', ['--version']);
  if (g.code !== 0) {
    die('没找到 git。', '到 https://git-scm.com/download/win 装一个，然后重新运行本设置。');
  }
  say('[通过] git：' + g.out);

  // 2. curl
  const c = run('curl.exe', ['--version']);
  if (c.code !== 0) die('没找到 curl.exe。', 'Windows 10 1803 以上自带，若确实没有请升级系统。');
  say('[通过] curl：' + c.out.split('\n')[0]);

  // 3. 代理
  const p = proxy();
  say('[信息] 代理：' + (p || '（直连）'));

  // 4. 凭据
  if (!haveCookies()) {
    say('[缺失] git 凭据 ' + COOKIES);
    say('');
    say('  这是本设置唯一需要你动手的一步，做一次，以后再也不用管。');
    say('  ★ 它生成的是 googlesource 专用的 git 密码，不是你的 Google 账号密码，');
    say('    随时可以在同一个页面吊销。工具不接触、不保存你的任何账号信息。');
    say('');
    say('  1) 我现在帮你用 Chrome 打开授权页（你已登录，不用再登）');
    say('  2) 页面上点 "Generate Password"');
    say('  3) 它会显示一段脚本，选 "Windows" 那个标签页，整段复制');
    say('  4) 粘进一个 cmd 窗口回车 —— 会写出 ' + COOKIES);
    say('  5) 回来再双击一次《设置.bat》');
    say('');
    openInChrome(GITILES + '/new-password');
    say('  已在浏览器打开：' + GITILES + '/new-password');
    say('');
    process.exit(2);
  }
  say('[通过] git 凭据：' + COOKIES);

  // 5. 发现仓库
  say('[进行] 正在问服务器你有哪些脚本仓库…');
  const d = discoverRepos();
  if (d.fatal) {
    die('拿不到仓库列表：' + d.fatal,
      '这不是凭据问题，是本机执行 curl 出了岔子。把上面这行原文发出来即可定位。');
  }
  if (d.error) {
    die('拿不到仓库列表：' + d.error,
      '多半是 .gitcookies 过期了。删掉 ' + COOKIES + ' 再跑一次《设置.bat》重新生成。');
  }

  const acct = accountFromCookies();
  if (!acct) die('从 ' + COOKIES + ' 里解不出用户名。', '删掉该文件重跑《设置.bat》重新生成凭据。');
  say('[通过] EE 用户名：' + acct);

  // ★ 这里必须按用户名过滤：/?format=JSON 返回的是全服务器所有仓库（三万多个）
  const mine = d.repos.filter(r => r.indexOf('users/' + acct + '/') === 0).sort();
  say('[通过] 服务器可见仓库 ' + d.repos.length + ' 个，其中你名下 ' + mine.length + ' 个');

  const want = (argv.find(a => a.indexOf('--repo=') === 0) || '').replace('--repo=', '');
  let repo = null;

  if (want) {
    repo = want;
    if (mine.indexOf(repo) < 0) {
      say('[注意] ' + repo + ' 不在你名下的列表里，仍按你指定的用。');
    }
  } else if (mine.length === 1) {
    repo = mine[0];
  } else if (mine.length === 0) {
    // ★ 全新账号会走到这里。EE 不会自动建仓库，也没有官方文档说的
    //   users/<你>/default，所以必须先在 Code Editor 里手动建一个。
    say('');
    say('你名下一个脚本仓库都还没有（全新账号常见）。');
    say('');
    say('  1) 打开 https://code.earthengine.google.com/');
    say('  2) 左边 Scripts 面板 → NEW → Repository → 取名 local-scripts');
    say('  3) 回来跑：');
    say('     node gee-open.js --setup --repo=users/' + acct + '/local-scripts');
    say('');
    say('  （EE 不支持 push 时自动建仓库，这一步躲不掉。）');
    say('');
    openInChrome('https://code.earthengine.google.com/');
    process.exit(2);
  } else {
    say('');
    say('你名下有 ' + mine.length + ' 个仓库。挑一个专门放本地脚本的，然后：');
    say('   node gee-open.js --setup --repo=users/' + acct + '/仓库名');
    say('');
    say('★ 建议**新建一个专用仓库**，别混进现有工作：');
    say('  Code Editor 左边 Scripts 面板 → NEW → Repository → 取名 local-scripts');
    say('  建好后跑：node gee-open.js --setup --repo=users/' + acct + '/local-scripts');
    say('');
    say('  你现有的仓库（供参考）：');
    mine.forEach(r => say('   ' + r));
    process.exit(2);
  }

  // 选定后先确认它真的存在且能推——比等到用的时候才报错好得多
  say('[进行] 校验仓库可达…');
  const ls = git(['ls-remote', '--heads', GITILES + '/' + repo]);
  if (ls.code !== 0) {
    die('仓库不可达：' + repo + '\n  ' + (ls.err || ls.out).split('\n')[0],
      '★ EE 不支持 push 时自动建仓库，必须先在 Code Editor 里建：\n'
      + '  Scripts 面板 → NEW → Repository → 取名后重跑本设置。');
  }
  say('[选定] 仓库：' + repo);

  // 6. 克隆
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const wantUrl = GITILES + '/' + repo;

  if (fs.existsSync(path.join(REPO_DIR, '.git'))) {
    const cur = git(['config', '--get', 'remote.origin.url'], REPO_DIR);
    if (cur.out === wantUrl) {
      say('[跳过] 本地已有同一个仓库的克隆：' + REPO_DIR);
    } else {
      // ★ 换了仓库（或换了账号）就必须重新克隆。
      //   只改 remote 会留着上一个仓库的历史，push 时容易撞出莫名其妙的错。
      say('[进行] 本地克隆指向的是别的仓库，删掉重克隆');
      say('        旧：' + (cur.out || '(读不出)'));
      say('        新：' + wantUrl);
      fs.rmSync(REPO_DIR, { recursive: true, force: true });
    }
  }

  if (!fs.existsSync(path.join(REPO_DIR, '.git'))) {
    say('[进行] 克隆到 ' + REPO_DIR + ' …');
    const cl = git(['clone', GITILES + '/' + repo, REPO_DIR]);
    if (cl.code !== 0) {
      die('克隆失败：' + (cl.err || cl.out).slice(0, 500),
        '若报 401/403，说明凭据无效：删掉 ' + COOKIES + ' 后重跑《设置.bat》。');
    }
    say('[通过] 克隆完成');
  }

  // ★ 键名用 ASCII：配置文件可能被各种编辑器打开，中文键在 GBK 环境下显示成乱码，
  //   容易被人"顺手改回来"从而改坏。值里的路径无法避免中文，但那是数据不是结构。
  fs.writeFileSync(CFG_PATH, JSON.stringify({
    repo: repo, repoDir: REPO_DIR, setupAt: new Date().toISOString()
  }, null, 2), 'utf8');

  say('');
  say('='.repeat(60));
  say('✓ 设置完成。以后直接右键任意 .js →「以 GEE 打开」。');
  say('  （还没注册右键菜单的话，双击一次《注册右键菜单.bat》）');
  say('');
}

// ----------------------------------------------------------------- 打开
function openScript(file, noBrowser) {
  const cfg = loadCfg();
  if (!cfg) die('还没设置过。', '先双击本目录的《设置.bat》。');

  // ★ 这三道检查全是为了「整个文件夹被拷到另一台电脑/另一个账号」这个场景。
  //   配置.json 是本机特有的，跟着文件夹走就会指向别人的仓库，
  //   不拦住的话报错会非常难懂（推送时 403，或者莫名其妙推到别人仓库）。
  if (!haveCookies()) {
    die('没有 git 凭据（' + COOKIES + '）。',
      '这台机器还没设置过。双击《设置.bat》，按提示生成一次凭据。');
  }
  const acct = accountFromCookies();
  if (acct && cfg.repo && cfg.repo.indexOf('users/' + acct + '/') !== 0) {
    die('配置里的仓库不属于当前账号。\n'
      + '  配置.json 写着：' + cfg.repo + '\n'
      + '  本机凭据的账号：' + acct,
      '这份配置是从别的电脑/账号带过来的。删掉本目录的 配置.json，重跑《设置.bat》。');
  }
  if (!fs.existsSync(path.join(cfg.repoDir, '.git'))) {
    die('本地克隆不见了：' + cfg.repoDir, '重新双击《设置.bat》即可。');
  }
  if (!fs.existsSync(file)) die('找不到文件：' + file);

  const src = fs.readFileSync(file, 'utf8');
  // EE 仓库里的脚本名不带扩展名，去掉 .js 让它在 Scripts 面板里好看
  const name = path.basename(file).replace(/\.js$/i, '');
  const repoDir = cfg.repoDir;

  say('▶ ' + name);

  // 先把本地对齐到服务端：这样你在 Code Editor 里改过的别的脚本不会被冲掉，
  // 而当前这个脚本以本地文件为准（本地文件才是源头）。
  say('  同步服务端…');
  const f = git(['fetch', 'origin'], repoDir);
  if (f.code !== 0) {
    die('拉取失败：' + (f.err || f.out).slice(0, 400),
      '常见原因：① 代理没开 ② .gitcookies 过期（删掉重跑《设置.bat》）');
  }
  git(['reset', '--hard', 'origin/master'], repoDir);

  fs.writeFileSync(path.join(repoDir, name), src, 'utf8');

  // ★ 判断「内容变没变」必须**先 add 再看暂存区**，不能用 git status。
  //   原因：Windows 上 core.autocrlf 默认常是 true，克隆时 LF→CRLF 写进工作区，
  //   于是 status 报「有改动」；但 add 又把 CRLF→LF 转回去，实际什么都没暂存，
  //   commit 直接报 "nothing to commit"。详见《说明.md》坑 12。
  git(['add', '-A'], repoDir);
  const staged = git(['diff', '--cached', '--quiet'], repoDir);  // 0=无变化 1=有变化
  if (staged.code === 1) {
    const cm = git(['commit', '-m', '更新 ' + name], repoDir);
    if (cm.code !== 0) die('提交失败：' + (cm.err || cm.out).slice(0, 400));
    say('  推送…');
    const ps = git(['push', 'origin', 'HEAD:master'], repoDir);
    if (ps.code !== 0) {
      die('推送失败：' + (ps.err || ps.out).slice(0, 400),
        '若报 401/403：删掉 ' + COOKIES + ' 后重跑《设置.bat》重新生成凭据。');
    }
    say('  已推送');
  } else {
    say('  内容没变，跳过推送');
  }

  const url = 'https://code.earthengine.google.com/?scriptPath='
    + cfg.repo + ':' + encodeURIComponent(name);

  // ★ --no-browser：只推送，不弹浏览器。
  //   给 AI 迭代用的——写一版推一版还每次弹标签页会把人烦死。
  //   约定是：中间迭代用 --no-browser，**最终版**才真开浏览器。
  if (noBrowser) {
    say('  已推送，未开浏览器（--no-browser）。要看就开这个：');
    say('  ' + url);
  } else {
    const who = openInChrome(url);
    say('  已用' + who + '打开：');
    say('  ' + url);
  }
  say('');
}

// ----------------------------------------------------------------- 右键菜单
// 只写 HKCU（当前用户），不需要管理员权限，随时可撤销。
// 挂在 SystemFileAssociations\.js 下面 —— 这样不动你 .js 的默认打开方式，
// 只是往右键菜单里多加一项。
const REG_KEY = 'HKCU\\Software\\Classes\\SystemFileAssociations\\.js\\shell\\OpenWithGEE';

function registerMenu() {
  const bat = path.join(TOOL_DIR, '以GEE打开.bat');
  // ★ 注册表里存的是这个 .bat 的**绝对路径**。所以文件夹一旦挪位置、
  //   或者换台电脑，都要重新跑一次《注册右键菜单.bat》。
  if (!fs.existsSync(bat)) die('找不到 ' + bat);

  let r = run('reg', ['add', REG_KEY, '/ve', '/d', '以 GEE 打开', '/f']);
  if (r.code !== 0) die('写注册表失败：' + (r.err || r.out));

  const chrome = findChrome();
  if (chrome) run('reg', ['add', REG_KEY, '/v', 'Icon', '/d', chrome + ',0', '/f']);

  r = run('reg', ['add', REG_KEY + '\\command', '/ve', '/d', '"' + bat + '" "%1"', '/f']);
  if (r.code !== 0) die('写注册表失败：' + (r.err || r.out));

  say('');
  say('✓ 已注册。现在右键任意 .js 文件就能看到「以 GEE 打开」。');
  say('  注册表位置（只写了当前用户，不需要管理员权限）：');
  say('  ' + REG_KEY);
  say('  想撤销就双击《取消右键菜单.bat》。');
  say('');
}

function unregisterMenu() {
  const r = run('reg', ['delete', REG_KEY, '/f']);
  say('');
  say(r.code === 0 ? '✓ 已移除右键菜单项。' : '（本来就没注册过，无需移除。）');
  say('');
}

// ----------------------------------------------------------------- 主流程
const argv = process.argv.slice(2);

if (argv.indexOf('--register') >= 0) {
  registerMenu();
} else if (argv.indexOf('--unregister') >= 0) {
  unregisterMenu();
} else if (argv.indexOf('--setup') >= 0) {
  setup(argv);
} else if (argv.indexOf('--status') >= 0) {
  const cfg = loadCfg();
  say('');
  if (!cfg) { say('还没设置。双击《设置.bat》。'); }
  else {
    say('仓库    ：' + cfg.repo);
    say('本地克隆：' + cfg.repoDir);
    say('凭据    ：' + (haveCookies() ? '有' : '缺失（重跑《设置.bat》）'));
    say('代理    ：' + (proxy() || '（直连）'));
    say('Chrome  ：' + (findChrome() || '没找到，会用系统默认浏览器'));
  }
  say('');
} else {
  const file = argv.filter(a => a.indexOf('--') !== 0)[0];
  if (!file) {
    say('');
    say('用法：');
    say('  node gee-open.js --setup                    一次性设置');
    say('  node gee-open.js <脚本.js>                  推送并用 Chrome 打开');
    say('  node gee-open.js <脚本.js> --no-browser     只推送，不弹浏览器（AI 迭代用）');
    say('  node gee-open.js --status                   看当前配置');
    say('  node gee-open.js --register / --unregister  装/卸右键菜单');
    say('');
    process.exit(1);
  }
  openScript(path.resolve(file), argv.indexOf('--no-browser') >= 0);
}
