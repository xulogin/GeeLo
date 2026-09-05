/**
 * GeeLo · 一步认证（不需要 Python）
 * ============================================================================
 * 它取代了原来那三条命令：
 *     pip install earthengine-api
 *     earthengine authenticate
 *     setx EE_PROJECT ee-xxx
 *
 * ★ 为什么不需要 Python：`earthengine authenticate` 干的事情，拆开看只有两步——
 *   ① 开浏览器拿一个 authorization code　② 拿它换 refresh_token 存进凭据文件。
 *   第 ② 步 跑GEE.js 早就自己实现了（它每次启动都用 refresh_token 换 access_token，
 *   用的就是 earthengine 命令行那个公开 client）。所以只差第 ① 步，补上就够了，
 *   Python 那一整套只是为了这一步而装的。
 *
 * ★ 为什么不用"复制授权码"：凭据文件里的 redirect_uri 是 http://localhost:8085 ——
 *   这个 client 本来就走**本地回环**。我们在本机起一个一次性的小服务器接住回调，
 *   用户点完「允许」浏览器自己跳回来，**什么都不用复制**。
 *
 * 用法：
 *   node 认证.js                    走完整流程（开浏览器 → 拿凭据 → 选项目 → setx）
 *   node 认证.js --project=ee-xxx   项目 ID 已知，跳过选择这一步
 *   node 认证.js --只认证            只拿凭据，不动项目 ID
 *   node 认证.js --force            已有凭据也重新认证（旧的会先备份）
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const querystring = require('querystring');
const { execFile, execFileSync } = require('child_process');

// earthengine 命令行工具自带的公开 client（与 跑GEE.js:64 用的是同一个）。
// ★ "installed app" 类型的 client_secret 按 Google 的定义就不是机密，
//   它随 earthengine-api 包公开分发。这里复用它是为了生成的凭据与
//   `earthengine authenticate` 产出的完全兼容——两边可以互换。
const CLIENT_ID = '517222506229-vsmmajv00ul0bs7p89v5m89qs8eb9359.apps.googleusercontent.com';
const CLIENT_SECRET = 'RUP0RZ6e0pPhDzsqIJ7KlNd1';

const SCOPES = [
  'https://www.googleapis.com/auth/earthengine',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/devstorage.full_control',
];

// ★ 端口跟 earthengine 命令行保持一致（8085）。占用了就往后顺延几个，
//   Desktop 类型的 client 允许任意 localhost 端口。
const 候选端口 = [8085, 8086, 8087, 8090, 8123];

const 凭据目录 = path.join(os.homedir(), '.config', 'earthengine');
const 凭据文件 = path.join(凭据目录, 'credentials');

const 参数 = process.argv.slice(2);
const 有 = (名) => 参数.some(a => a === 名);
const 取值 = (名) => {
  const hit = 参数.find(a => a.indexOf(名 + '=') === 0);
  return hit ? hit.slice(名.length + 1) : null;
};
const FORCE = 有('--force');
const 只认证 = 有('--只认证') || 有('--auth-only');
const 指定项目 = 取值('--project');

function say(s) { process.stdout.write(s + '\n'); }
function 分割线() { say('──────────────────────────────────────────────────────────────'); }

// ---------------------------------------------------------------- 网络
// 代理由 代理探测.js 探好后写进 process.env，这里现建 agent（理由同 跑GEE.js:81）
function agent() {
  const p = process.env.HTTPS_PROXY || process.env.https_proxy
         || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!p) { return undefined; }
  try {
    return require('./代理agent.js').makeAgent(p);
  } catch (e) { return undefined; }
}

function 请求(选项, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(Object.assign({ agent: agent() }, 选项), res => {
      let buf = '';
      res.on('data', d => { buf += d; });
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(buf); } catch (e) { /* 留给下面报错 */ }
        if (!j) { return reject(new Error('返回的不是 JSON（HTTP ' + res.statusCode + '）：' + buf.slice(0, 200))); }
        if (j.error) {
          const 描述 = j.error_description || (j.error.message || j.error);
          return reject(new Error(描述));
        }
        resolve(j);
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(new Error('请求超时')); });
    if (body) { req.write(body); }
    req.end();
  });
}

// ---------------------------------------------------------------- 认证流程
function 生成PKCE() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function 起服务器() {
  return new Promise((resolve, reject) => {
    let i = 0;
    const 试 = () => {
      if (i >= 候选端口.length) {
        return reject(new Error('候选端口全被占用了：' + 候选端口.join(', ')
          + '\n  关掉占用它们的程序再试，或者重启一下电脑。'));
      }
      const port = 候选端口[i++];
      const 收到 = {};
      const server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://localhost:' + port);
        const code = u.searchParams.get('code');
        const err = u.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><meta charset="utf-8">'
          + '<body style="font-family:system-ui;padding:60px;text-align:center">'
          + (code
              ? '<h2>✓ 授权成功</h2><p>可以关掉这个标签页，回到命令行窗口。</p>'
              : '<h2>✗ 授权被取消</h2><p>回命令行窗口重试。</p>')
          + '</body>');
        收到.code = code;
        收到.err = err;
        server.close();
        if (code) { 收到.resolve(code); } else { 收到.reject(new Error(err || '用户取消了授权')); }
      });
      server.on('error', e => {
        if (e.code === 'EADDRINUSE') { return 试(); }
        reject(e);
      });
      server.listen(port, '127.0.0.1', () => {
        // ★ 这个 Promise 必须在服务器起来的**同时**就建好，不能等 等授权() 被调用才建。
        //   否则回调先到、调用者还没 await，拒绝就成了"未处理拒绝"——Node 15+ 会
        //   直接杀掉进程（实测过一次）。
        const 授权结果 = new Promise((res2, rej2) => { 收到.resolve = res2; 收到.reject = rej2; });
        // 挂一个空 catch 兜底：它处理的是**派生**的那个 Promise，
        // 原来那个照样会把错误交给真正 await 它的人，不会被吞掉。
        授权结果.catch(() => {});
        resolve({
          port,
          等授权: () => 授权结果,
          关掉: () => { try { server.close(); } catch (e) { /* 已经关了 */ } },
        });
      });
    };
    试();
  });
}

function 开浏览器(url) {
  // ★ 用默认浏览器，不指定 Chrome —— 用户的 Google 账号登在哪个浏览器里我们不知道。
  //   start 的第一个引号参数是窗口标题，必须留着，否则带 & 的 URL 会被当成标题。
  execFile('cmd', ['/c', 'start', '', url], { windowsHide: true }, () => {});
}

async function 认证() {
  const { verifier, challenge } = 生成PKCE();
  const 服务器 = await 起服务器();
  const redirect = 'http://localhost:' + 服务器.port;

  const url = 'https://accounts.google.com/o/oauth2/auth?' + querystring.stringify({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirect,
    scope: SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',           // ★ 必须，否则第二次授权拿不到 refresh_token
  });

  say('');
  say('  正在打开浏览器，请在里面选择你的 Google 账号并点「允许」。');
  say('');
  say('  如果浏览器没自动弹出，手动复制下面这行地址打开：');
  say('  ' + url);
  say('');
  say('  等待授权…（点完「允许」这里会自动继续，你不用复制任何东西）');

  开浏览器(url);

  let code;
  try {
    code = await 服务器.等授权();
  } finally {
    服务器.关掉();
  }

  say('  ✓ 收到授权码，正在换取长期凭据…');

  const body = querystring.stringify({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    code_verifier: verifier,
    redirect_uri: redirect,
    grant_type: 'authorization_code',
  });
  const tok = await 请求({
    hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);

  if (!tok.refresh_token) {
    throw new Error('Google 没给 refresh_token。多半是这个账号之前授权过而没带 prompt=consent。\n'
      + '  去 https://myaccount.google.com/permissions 撤销「Earth Engine」的授权后重试。');
  }

  // ---- 写凭据（旧的先备份）
  if (fs.existsSync(凭据文件)) {
    const 备份 = 凭据文件 + '.bak.' + Date.now();
    fs.copyFileSync(凭据文件, 备份);
    say('  旧凭据已备份到　' + 备份);
  }
  fs.mkdirSync(凭据目录, { recursive: true });
  // ★ 字段与 earthengine authenticate 产出的保持一致，两边可互换。
  fs.writeFileSync(凭据文件, JSON.stringify({
    redirect_uri: redirect,
    refresh_token: tok.refresh_token,
    scopes: SCOPES,
  }, null, 2), 'utf8');
  // ★ 只有本人可读。凭据等同于账号钥匙。
  try { fs.chmodSync(凭据文件, 0o600); } catch (e) { /* Windows 上可能无效，不致命 */ }

  say('  ✓ 凭据已写入　' + 凭据文件);
  return tok.access_token;
}

// ---------------------------------------------------------------- 项目 ID
async function 列项目(access_token) {
  const j = await 请求({
    hostname: 'cloudresourcemanager.googleapis.com',
    path: '/v1/projects?filter=' + encodeURIComponent('lifecycleState:ACTIVE'),
    method: 'GET',
    headers: { Authorization: 'Bearer ' + access_token },
  });
  return (j.projects || []).map(p => ({ id: p.projectId, 名: p.name || '' }));
}

function 问(提示) {
  return new Promise(resolve => {
    process.stdout.write(提示);
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', d => resolve(String(d).trim()));
  });
}

function 设环境变量(id) {
  try {
    execFileSync('setx', ['EE_PROJECT', id], { stdio: 'ignore', windowsHide: true });
    process.env.EE_PROJECT = id;
    return true;
  } catch (e) { return false; }
}

async function 配项目(access_token) {
  if (指定项目) {
    设环境变量(指定项目)
      ? say('  ✓ 项目 ID 已设为　' + 指定项目 + '　（写进了 EE_PROJECT 环境变量）')
      : say('  ✗ setx 失败，请手动执行：setx EE_PROJECT ' + 指定项目);
    return;
  }

  say('  正在列出你的 Google Cloud 项目…');
  let 项目;
  try {
    项目 = await 列项目(access_token);
  } catch (e) {
    say('  ⚠ 列项目失败：' + e.message);
    say('    不影响凭据。手动设一下就行：setx EE_PROJECT <你的项目ID>');
    say('    在哪看：code.earthengine.google.com 右上角的项目选择器。');
    return;
  }

  if (项目.length === 0) {
    say('  ⚠ 这个账号下没有活跃的 Cloud 项目。');
    say('    去 https://code.earthengine.google.com 注册一个（学术用途免费），');
    say('    然后：setx EE_PROJECT <项目ID>');
    return;
  }

  if (项目.length === 1) {
    say('  只有一个项目，直接用它：' + 项目[0].id);
    设环境变量(项目[0].id)
      ? say('  ✓ 项目 ID 已设为　' + 项目[0].id + '　（写进了 EE_PROJECT 环境变量）')
      : say('  ✗ setx 失败，请手动执行：setx EE_PROJECT ' + 项目[0].id);
    return;
  }

  say('');
  say('  你有这些项目：');
  项目.forEach((p, i) => say('    ' + String(i + 1).padStart(2) + '. ' + p.id + (p.名 ? '　（' + p.名 + '）' : '')));
  say('');

  // ★ 被 AI 或脚本调用时没有 TTY，问也没人答 —— 那就把清单打出来，让它带 --project 再跑一次。
  if (!process.stdin.isTTY) {
    say('  当前不是交互式终端，没法让你选。');
    say('  挑一个，然后执行：');
    say('    node "' + __filename + '" --project=<上面某个ID>');
    say('  （凭据已经拿到了，这一步只是设项目 ID，不用再认证一次。）');
    return;
  }

  const 答 = await 问('  输入序号（直接回车用第 1 个）：');
  const n = 答 === '' ? 1 : parseInt(答, 10);
  const 选中 = 项目[(isNaN(n) ? 1 : n) - 1] || 项目[0];
  设环境变量(选中.id)
    ? say('  ✓ 项目 ID 已设为　' + 选中.id + '　（写进了 EE_PROJECT 环境变量）')
    : say('  ✗ setx 失败，请手动执行：setx EE_PROJECT ' + 选中.id);
}

// ---------------------------------------------------------------- 主流程
// ★ 只有被直接执行时才跑主流程。被 require 进来时只导出零件——
//   这样回环服务器和 PKCE 这两段能单独测，不用真去点一次 Google 授权。
module.exports = { 生成PKCE, 起服务器, CLIENT_ID, SCOPES, 凭据文件 };

if (require.main !== module) { return; }

(async function main() {
  say('');
  say('══════════════════════════════════════════════════════════════');
  say('  GeeLo · 一步认证');
  say('══════════════════════════════════════════════════════════════');

  if (fs.existsSync(凭据文件) && !FORCE) {
    say('');
    say('  已经有凭据了：' + 凭据文件);
    say('');
    say('  要重新认证（换账号、或凭据失效了）就加 --force：');
    say('    node "' + __filename + '" --force');
    say('  只想设项目 ID：');
    say('    node "' + __filename + '" --project=<你的项目ID>');
    say('');
    if (指定项目) {
      分割线();
      await 配项目(null);
      say('');
    }
    process.exit(0);
  }

  // 先找一条能通 Google 的路（跟 跑GEE.js 用同一套探测）
  try {
    const { readProxy } = require('./配置读取.js');
    const { resolveProxy, apply } = require('./代理探测.js');
    const pr = await resolveProxy(readProxy(__dirname), null);
    apply(pr.proxy);
    say('');
    say('  联网方式：' + (pr.proxy ? pr.proxy + '（' + pr.from + '）' : pr.from));
    if (!pr.proxy && pr.from.indexOf('直连') !== 0) {
      say('  ⚠ 没找到能连通 Google 的方式，下面多半会失败。');
    }
  } catch (e) {
    say('');
    say('  ⚠ 代理探测跳过了：' + e.message);
    say('    （依赖没装齐？先在本目录跑 npm install）');
  }

  分割线();
  let access_token;
  try {
    access_token = await 认证();
  } catch (e) {
    say('');
    say('  ✗ 认证失败：' + e.message);
    say('');
    say('  常见原因：连不上 Google（代理没通）、在浏览器里点了「取消」、');
    say('            或者等太久授权码过期了。重跑一次就行。');
    say('');
    process.exit(2);
  }

  if (!只认证) {
    分割线();
    await 配项目(access_token);
  }

  say('');
  say('══════════════════════════════════════════════════════════════');
  say('  认证完成。');
  say('');
  say('  ★ EE_PROJECT 是用 setx 写的，**当前这个终端读不到**，');
  say('    新开一个窗口才生效。');
  say('');
  say('  验证一下：node "' + path.join(__dirname, '环境自检.js') + '"');
  say('══════════════════════════════════════════════════════════════');
  say('');
  process.exit(0);
})();
