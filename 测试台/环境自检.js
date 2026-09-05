/**
 * GeeLo · 环境自检 —— 新电脑第一件事，先跑这个
 * ============================================================================
 * 双击 `环境自检.bat`，或命令行 `node 环境自检.js`
 *
 * 它会逐项检查、并**告诉你每一项失败时该怎么办**，不用去翻文档。
 * 全部通过 = 可以开始用了。
 *
 * 本文件只做检查，不改任何东西，不消耗 GEE 配额（最后一项只算 1+1）。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const querystring = require('querystring');

const HERE = __dirname;

// ★★ 这一段必须在 require('@google/earthengine') **之前**执行。
//    见《说明.md》坑 2：EE 客户端在被加载的那一刻就会 require('xmlhttprequest')
//    并把它记下来；之后再替换 global.XMLHttpRequest 已经晚了，
//    表现为最后一项「真连 EE」莫名其妙 ETIMEDOUT。
//    （写这个自检脚本时我自己又踩了一次，所以在这里再标一遍。）
try {
  const { ProxyXHR } = require(path.join(HERE, 'xhr代理.js'));
  global.XMLHttpRequest = ProxyXHR;
  const Module = require('module');
  const _load = Module._load;
  Module._load = function (request) {
    if (request === 'xmlhttprequest') { return { XMLHttpRequest: ProxyXHR }; }
    return _load.apply(this, arguments);
  };
} catch (e) { /* xhr代理.js 缺失时，第 3 项会报出来 */ }

let pass = 0, fail = 0;
const todo = [];

function ok(title, detail) {
  pass++;
  console.log('  [通过] ' + title + (detail ? '　' + detail : ''));
}
function bad(title, detail, how) {
  fail++;
  console.log('  [失败] ' + title + (detail ? '　' + detail : ''));
  if (how) {
    console.log('         ↳ 怎么办：' + how.split('\n').join('\n                   '));
    todo.push(title + ' —— ' + how.split('\n')[0]);
  }
}
function info(s) { console.log('         ' + s); }
function head(n, s) {
  console.log('');
  console.log('【' + n + '】' + s);
  console.log('─'.repeat(74));
}

console.log('='.repeat(74));
console.log('  GeeLo 测试台 · 环境自检');
console.log('  目录：' + HERE);
console.log('='.repeat(74));

// ── 1. Node 版本 ───────────────────────────────────────────────────────────
head(1, 'Node.js');
// ★ 门槛是 20.19，不是 16：依赖 https-proxy-agent@9 是纯 ESM 包（"type":"module"，
//   engines 声明 >=20），而本项目用 CommonJS 的 require() 加载它。
//   require(ESM) 要 Node >= 20.19 或 >= 22.12 才默认放开，否则 ERR_REQUIRE_ESM。
const [vMaj, vMin] = process.versions.node.split('.').map(Number);
const nodeOK = vMaj > 20 || (vMaj === 20 && vMin >= 19);
if (nodeOK) ok('Node 版本', 'v' + process.versions.node);
else bad('Node 版本', 'v' + process.versions.node + '，太老',
  '需要 Node 20.19+（推荐 22 LTS 或更高）。\n'
  + '原因：依赖包是纯 ESM，老版本 Node 用 require() 加载会报 ERR_REQUIRE_ESM。\n'
  + '下载：https://nodejs.org/');

// ── 2. 依赖 ───────────────────────────────────────────────────────────────
head(2, '依赖包');
let eeMod = null;
try {
  eeMod = require('@google/earthengine');
  const v = require(path.join(HERE, 'node_modules', '@google', 'earthengine', 'package.json')).version;
  ok('@google/earthengine', 'v' + v);
} catch (e) {
  bad('@google/earthengine', '没装', '在本目录（' + HERE + '）执行：\n  npm install');
}
try {
  require('https-proxy-agent');
  ok('https-proxy-agent', '已装');
} catch (e) {
  // ★ 区分"没装"和"Node 太老"：后者包是装了的，再 npm install 一万次也没用。
  if (e && e.code === 'ERR_REQUIRE_ESM') {
    bad('https-proxy-agent', '包已装，但 **Node 版本太老**（当前 v' + process.versions.node + '）',
      '这个包是纯 ESM，require() 加载它需要 Node 20.19+。\n'
      + '升级 Node 即可，不用重装依赖：https://nodejs.org/');
  } else {
    bad('https-proxy-agent', '没装', '在本目录执行：npm install');
  }
}

// ── 3. 关键文件 ────────────────────────────────────────────────────────────
head(3, '本目录文件是否齐全');
// ★ 这张清单必须覆盖**本文件下面会 require 的每一个** .js，否则那个文件缺失时
//   不会走到这里给出友好提示，而是在第 6 项直接抛异常。
//   （2026-08-18 就漏了 代理探测.js，已补。以后新增依赖文件记得同步加进来。）
[['跑GEE.js', '主程序'], ['xhr代理.js', '代理版 XHR'],
 ['代理探测.js', '代理自动探测（第 6 项要用）'],
 ['配置读取.js', '配置解析（与本自检共用）'], ['配置.txt', '项目 ID 配置'],
 ['说明.md', '文档'], ['原理.txt', '原理说明'], ['package.json', '依赖清单'],
 ['示例', '示例脚本目录']].forEach(([f, d]) => {
  if (fs.existsSync(path.join(HERE, f))) ok(f, d);
  else bad(f, '缺失（' + d + '）', '重新克隆 / 拷贝一份完整的 GeeLo\\测试台\\ 目录');
});

// ── 4. 项目 ID ─────────────────────────────────────────────────────────────
head(4, 'GEE 项目 ID');
const { readProject } = require(path.join(HERE, '配置读取.js'));
const _p = readProject(HERE);
const PROJECT = _p.value;
if (_p.warn) {
  // ★ 提示语整段由 配置读取.js 给出，这里不再自己拼一遍 ——
  //   两处各写一份的话，改了一处另一处就成了过时的错话。
  bad('项目 ID', _p.value + '（来自' + _p.from + '）', _p.warn);
} else {
  ok('项目 ID', PROJECT + '　（来自' + _p.from + '）');
}

// ── 5. 凭据 ───────────────────────────────────────────────────────────────
head(5, 'GEE 凭据');
const credPath = path.join(os.homedir(), '.config', 'earthengine', 'credentials');
let refresh = null;
if (!fs.existsSync(credPath)) {
  bad('凭据文件', '不存在：' + credPath,
    '跑一次认证（会自动开浏览器，点「允许」就完事，不用装 Python）：\n'
    + '  node "' + path.join(__dirname, '认证.js') + '"');
} else {
  try {
    refresh = JSON.parse(fs.readFileSync(credPath, 'utf8')).refresh_token;
    if (refresh) ok('凭据文件', credPath);
    else bad('凭据文件', '里面没有 refresh_token',
      '重新认证：node "' + path.join(__dirname, '认证.js') + '" --force');
  } catch (e) {
    bad('凭据文件', '读不出来：' + e.message,
      '重新认证（旧的会自动备份）：node "' + path.join(__dirname, '认证.js') + '" --force');
  }
}

// ── 6. 代理（自动探测） ───────────────────────────────────────────────────
// 说明：双击 .bat 开的是全新 cmd，**不继承**你在别处 set 过的 HTTPS_PROXY，
//       所以这里不能只看环境变量，要真的去找一个能用的代理。
const { readProxy } = require(path.join(HERE, '配置读取.js'));
const { resolveProxy, apply } = require(path.join(HERE, '代理探测.js'));

// 现读环境变量：代理探测的结果是写进 process.env 的，不能在模块加载时读死
function agent() {
  const P = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (!P) { return undefined; }
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    return new HttpsProxyAgent(P);
  } catch (e) { return undefined; }
}

function probe(host) {
  return new Promise(res => {
    const req = https.request({ hostname: host, path: '/', method: 'HEAD',
      agent: agent(), timeout: 15000 }, r => { res({ ok: true, code: r.statusCode }); r.resume(); });
    req.on('error', e => res({ ok: false, err: e.code || e.message }));
    req.on('timeout', () => { req.destroy(); res({ ok: false, err: 'TIMEOUT' }); });
    req.end();
  });
}

// ── 6—9 是异步的 ───────────────────────────────────────────────────────────
(async function () {
  head(6, '网络与代理');
  console.log('         正在自动寻找可用的联网方式（最多约 20 秒）…');
  const pr = await resolveProxy(readProxy(HERE), s => console.log('  ' + s));
  apply(pr.proxy);
  if (pr.proxy) {
    ok('代理', pr.proxy + '　（' + pr.from + '）');
    if (pr.from.indexOf('自动探测') === 0) {
      info('提示：想固定下来免得每次探测，把它写进 配置.txt 的「代理 =」那一行。');
    }
  } else if (pr.from.indexOf('直连') === 0) {
    ok('联网方式', '直连（这台机器不需要代理）');
  } else {
    bad('代理', '没找到能连通 Google 的方式',
      '① 确认代理软件（v2rayN / Clash 等）正在运行；\n'
      + '② 在 配置.txt 的「代理 =」那一行填上你的代理地址，例如\n'
      + '     代理 = http://127.0.0.1:10808\n'
      + '   端口在代理软件的设置里看（找 HTTP 代理端口 / 混合端口）。');
    if (pr.tried.length) { info('试过：' + pr.tried.join('；')); }
  }

  head(7, '能不能连上 Google');
  for (const h of ['oauth2.googleapis.com', 'earthengine.googleapis.com']) {
    const r = await probe(h);
    if (r.ok) ok(h, 'HTTP ' + r.code + '（能通就行，状态码不重要）');
    else bad(h, r.err, '见上面第 6 项——先把联网方式解决。');
  }

  head(8, '凭据能不能换到令牌');
  if (!refresh) {
    bad('换取令牌', '跳过（上面凭据那步没过）', '先解决第 5 项');
  } else {
    let CID = '', CS = '';
    try {
      const s = fs.readFileSync(path.join(HERE, '跑GEE.js'), 'utf8');
      CID = (s.match(/const CLIENT_ID = '([^']+)'/) || [])[1] || '';
      CS = (s.match(/const CLIENT_SECRET = '([^']+)'/) || [])[1] || '';
    } catch (e) { /* ignore */ }
    if (!CID || !CS) {
      bad('换取令牌', '跑GEE.js 里没读到 CLIENT_ID/SECRET', '确认 跑GEE.js 完整');
    } else {
      const body = querystring.stringify({ client_id: CID, client_secret: CS,
        refresh_token: refresh, grant_type: 'refresh_token' });
      const r = await new Promise(res => {
        const req = https.request({ hostname: 'oauth2.googleapis.com', path: '/token',
          method: 'POST', agent: agent(), timeout: 25000,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                     'Content-Length': Buffer.byteLength(body) } }, resp => {
          let d = ''; resp.on('data', c => d += c);
          resp.on('end', () => res({ status: resp.statusCode, body: d }));
        });
        req.on('error', e => res({ status: 0, body: String(e.message) }));
        req.on('timeout', () => { req.destroy(); res({ status: 0, body: 'TIMEOUT' }); });
        req.end(body);
      });
      let j = {};
      try { j = JSON.parse(r.body); } catch (e) { /* ignore */ }
      if (j.access_token) {
        ok('换取令牌', '成功，有效期 ' + j.expires_in + ' 秒');
        global.__TOKEN__ = j;
      } else if (j.error === 'invalid_grant') {
        bad('换取令牌', 'refresh_token 已失效',
          '重新认证一次：node "' + path.join(__dirname, '认证.js') + '" --force');
      } else if (j.error === 'invalid_client') {
        bad('换取令牌', 'CLIENT_ID/SECRET 不对',
          '从已装的 Python 包读真值，填回 跑GEE.js 顶部：\n'
          + '  py -3.12 -c "import ee.oauth as O; print(O.CLIENT_ID); print(O.CLIENT_SECRET)"');
      } else {
        bad('换取令牌', '失败：' + String(r.body).slice(0, 120),
          '多半是网络/代理问题，先看第 7 项');
      }
    }
  }

  head(9, '真连一次 Earth Engine（只算 1+1，不烧配额）');
  const tok = global.__TOKEN__;
  if (!tok || !eeMod || !PROJECT) {
    bad('连接 EE', '跳过（前面有项没过）', '把上面标 [失败] 的项解决后重跑');
  } else {
    try {
      const ee = eeMod;   // 代理拦截已在文件顶部完成，这里不用再做
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('初始化超时（60 秒）')), 60000);
        ee.data.setAuthToken('', 'Bearer', tok.access_token, tok.expires_in, [], () => {
          ee.data.setProject(PROJECT);
          ee.initialize(null, null, () => { clearTimeout(t); res(); },
                        e => { clearTimeout(t); rej(new Error(String(e))); }, null, PROJECT);
        }, false);
      });
      const v = ee.Number(1).add(1).getInfo();
      if (v === 2) ok('连接 EE', '1 + 1 = 2　★ 一切就绪，可以开始用了');
      else bad('连接 EE', '返回值异常：' + v, '重跑一次试试');
    } catch (e) {
      const m = String(e.message || e);
      // ★ 分支顺序有讲究：项目类的错要排在网络类前面。
      //   否则"项目不存在"会掉进最后那个兜底分支，被建议去查代理——
      //   而人一旦被指错方向，就会在错的那一层反复折腾。
      if (/not found or deleted|not found|does not exist/i.test(m)) {
        bad('连接 EE', '项目「' + PROJECT + '」不存在',
          PROJECT === require(path.join(HERE, '配置读取.js')).PLACEHOLDER
            ? '这就是上面第 4 项说的占位符。先把 配置.txt 里的项目 ID 改成你自己的，再重跑本自检。'
            : '项目 ID 写错了，或者这个项目已被删除。\n'
              + '去 code.earthengine.google.com 右上角的项目选择器核对一下，'
              + '改 配置.txt 的「项目ID=」。');
      } else if (/not registered|not signed up/i.test(m)) {
        bad('连接 EE', '项目「' + PROJECT + '」没注册 Earth Engine',
          '换成你自己已注册的项目：改 配置.txt 的「项目ID=」。\n'
          + '若还没有，去 code.earthengine.google.com 注册一个（学术用途免费）。');
      } else if (/permission/i.test(m)) {
        bad('连接 EE', '对项目「' + PROJECT + '」没权限',
          '这个项目多半不是你的。改 配置.txt 换成自己的项目 ID。');
      } else {
        bad('连接 EE', m.slice(0, 160), '若是网络类报错，先看第 6、7 项');
      }
    }
  }

  // ── 总结 ────────────────────────────────────────────────────────────────
  console.log('');
  console.log('='.repeat(74));
  console.log('  自检结果：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('='.repeat(74));
  if (fail === 0) {
    console.log('');
    console.log('  ★ 全部通过。试一下：');
    console.log('      node 跑GEE.js 示例\\演示_这就是CodeEditor的JS.js');
    console.log('');
    console.log('    用法详见本目录的《说明.md》。');
  } else {
    console.log('');
    console.log('  待办（按顺序处理，前面的解决了后面的可能自动好）：');
    todo.forEach((s, i) => console.log('    ' + (i + 1) + '. ' + s));
    console.log('');
    console.log('  每项的详细做法见上面对应的「↳ 怎么办」。');
    console.log('  还搞不定就把这份输出整个复制，连同《说明.md》一起给 AI 助手看。');
  }
  console.log('');
  process.exit(fail ? 1 : 0);
})();
