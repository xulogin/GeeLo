/**
 * 代理探测 —— 让工具自己找到本机代理，不用每次 set 环境变量
 * ============================================================================
 * 为什么需要：双击 .bat 开的是全新 cmd 窗口，**不继承**你在别处 set 过的
 * HTTPS_PROXY。结果就是"命令行里跑得好好的，一双击就连不上 Google"。
 *
 * 解决顺序（与下面 resolveProxy() 的实现严格一致，改代码要同步改这里）：
 *   ① 配置.txt 里的「代理 = ...」（写死，最可靠）
 *   ② 环境变量 HTTPS_PROXY / HTTP_PROXY
 *   ③ **Windows 系统代理设置**（注册表）—— 代理软件开着时基本都会设它
 *   ④ **先试直连** —— 有些网络本来就不需要代理，别绕远路
 *   ⑤ **自动探测**：挨个试常见的本机代理端口，哪个能连通 Google 就用哪个
 *   都不行 → 返回「找不到可用代理」，由调用方提示用户
 *
 * ★ 每一级都不是"看着像就采信"：端口开着不算数，必须真的 HEAD 通
 *   oauth2.googleapis.com 才算数。
 *
 * ★ 第 ③ 级是后加的，因为**每个人的端口都不一样**。硬编码一张常见端口表，
 *   碰上把端口改成 23457 的人就抓瞎；而系统代理设置里写的就是他实际用的那个。
 *
 * ★ 每个端口要试 **http 和 socks5 两种协议**。v2rayN 默认的 10808 是 SOCKS，
 *   只按 http 试的话表现是「端口开着但连不通 Google」，极难查。
 */
'use strict';

const net = require('net');
const https = require('https');
const { execFileSync } = require('child_process');
const { makeAgent } = require('./代理agent.js');

// 常见代理软件的默认本地端口（按常见程度排序）
// ★ 这只是兜底。优先级更高的是「系统代理设置」，那里才有用户实际改过的端口。
const COMMON_PORTS = [
  10808,  // v2rayN / v2rayA —— 默认是 SOCKS（不是 HTTP，以前这里注释写错过）
  10809,  // v2rayN 的 HTTP 口
  7890,   // Clash / Clash for Windows
  7897,   // Clash Verge
  1080,   // 通用（多为 SOCKS）
  8080,   // 通用
  8888,   // Fiddler / Charles
  2080,   // Nekoray
  10000,
];

/**
 * 读 Windows 系统代理设置。代理软件（v2rayN / Clash…）开「系统代理」时会写这里，
 * 所以不管用户把端口改成多少，这里都拿得到。
 * @returns {string|null} 形如 http://127.0.0.1:10809
 */
function systemProxy() {
  if (process.platform !== 'win32') { return null; }
  let out;
  try {
    out = execFileSync('reg',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
       '/v', 'ProxyServer'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  } catch (e) { return null; }   // 没设过系统代理时 reg 会返回非 0

  // 输出形如：    ProxyServer    REG_SZ    127.0.0.1:10809
  const m = out.match(/ProxyServer\s+REG_SZ\s+(.+)/i);
  if (!m) { return null; }
  const raw = m[1].trim();
  if (!raw) { return null; }

  // 两种写法：「host:port」统一用；或「http=x:1;https=y:2;socks=z:3」分协议
  if (raw.indexOf('=') >= 0) {
    const 各项 = {};
    raw.split(';').forEach(seg => {
      const kv = seg.split('=');
      if (kv.length === 2) { 各项[kv[0].trim().toLowerCase()] = kv[1].trim(); }
    });
    // 我们要发的是 HTTPS 请求，优先 https，其次 http，最后 socks
    if (各项.https) { return 'http://' + 各项.https; }
    if (各项.http) { return 'http://' + 各项.http; }
    if (各项.socks) { return 'socks5://' + 各项.socks; }
    return null;
  }
  return /^\w+:\/\//.test(raw) ? raw : 'http://' + raw;
}

/** 本地端口开着没？（很快，几十毫秒） */
function portOpen(port, timeout) {
  return new Promise(res => {
    const s = new net.Socket();
    let done = false;
    const fin = v => { if (!done) { done = true; s.destroy(); res(v); } };
    s.setTimeout(timeout || 400);
    s.once('connect', () => fin(true));
    s.once('timeout', () => fin(false));
    s.once('error', () => fin(false));
    s.connect(port, '127.0.0.1');
  });
}

/** 用这个代理**真的能不能连到 Google**（端口开着不等于是能用的代理） */
function proxyWorks(url, timeout) {
  return new Promise(res => {
    const agent = makeAgent(url);     // ★ http / socks 都认，见 代理agent.js
    if (!agent) { return res(false); }
    const req = https.request({
      hostname: 'oauth2.googleapis.com', path: '/', method: 'HEAD',
      agent, timeout: timeout || 6000,
    }, r => { r.resume(); res(true); });
    req.on('error', () => res(false));
    req.on('timeout', () => { req.destroy(); res(false); });
    req.end();
  });
}

/** 不走代理能不能直连 Google */
function directWorks(timeout) {
  return new Promise(res => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com', path: '/', method: 'HEAD',
      timeout: timeout || 6000,
    }, r => { r.resume(); res(true); });
    req.on('error', () => res(false));
    req.on('timeout', () => { req.destroy(); res(false); });
    req.end();
  });
}

/**
 * 定下这次要用的代理。
 * @param {string|null} fromConfig 配置.txt 里写的（没有就传 null）
 * @param {function} log 想看探测过程就传一个打印函数
 * @returns {{proxy:string|null, from:string, tried:string[]}}
 */
async function resolveProxy(fromConfig, log) {
  const say = log || (() => {});
  const tried = [];

  // ① 配置.txt 写死的，优先
  if (fromConfig) {
    say('  配置.txt 指定了代理 ' + fromConfig + '，正在验证…');
    if (await proxyWorks(fromConfig)) {
      return { proxy: fromConfig, from: '配置.txt', tried };
    }
    say('  ✗ 配置.txt 里的代理连不通，继续往下找');
    tried.push(fromConfig + '（配置.txt，不通）');
  }

  // ② 环境变量
  const env = process.env.HTTPS_PROXY || process.env.https_proxy
           || process.env.HTTP_PROXY || process.env.http_proxy;
  if (env) {
    say('  环境变量指定了代理 ' + env + '，正在验证…');
    if (await proxyWorks(env)) {
      return { proxy: env, from: '环境变量', tried };
    }
    say('  ✗ 环境变量里的代理连不通，继续往下找');
    tried.push(env + '（环境变量，不通）');
  }

  // ③ Windows 系统代理设置 —— 用户实际用的那个端口就写在这儿，不用猜
  const sys = systemProxy();
  if (sys) {
    say('  系统代理设置里写着 ' + sys + '，正在验证…');
    if (await proxyWorks(sys)) {
      return { proxy: sys, from: '系统代理设置', tried };
    }
    // ★ 系统代理常被填成 SOCKS 端口却没写协议头（注册表里就是个 host:port）。
    //   上面按 http 试失败了，这里再按 socks5 试一次同一个地址。
    const 换协议 = sys.replace(/^https?:\/\//, 'socks5://');
    if (换协议 !== sys) {
      say('  ✗ 按 HTTP 不通，改按 SOCKS5 再试同一个地址…');
      if (await proxyWorks(换协议)) {
        return { proxy: 换协议, from: '系统代理设置（SOCKS5）', tried };
      }
    }
    say('  ✗ 系统代理设置里那个连不通，继续往下找');
    tried.push(sys + '（系统代理设置，不通）');
  }

  // ④ 先试直连——不需要代理的网络就别绕了
  say('  正在试直连…');
  if (await directWorks(5000)) {
    return { proxy: null, from: '直连（不需要代理）', tried };
  }
  say('  ✗ 直连不通，开始扫本机常见代理端口…');

  // ⑤ 扫常见端口。先并发筛出"开着的"，再逐个验证能不能真的连 Google
  const opens = [];
  await Promise.all(COMMON_PORTS.map(async p => {
    if (await portOpen(p)) { opens.push(p); }
  }));
  opens.sort((a, b) => COMMON_PORTS.indexOf(a) - COMMON_PORTS.indexOf(b));

  if (!opens.length) {
    say('  ✗ 本机常见代理端口都没开');
    return { proxy: null, from: '找不到可用代理', tried };
  }
  say('  本机开着的端口：' + opens.join('、') + '，逐个验证…');

  // ★ 每个端口都要试两种协议。只试 http 的话，SOCKS 端口会表现成
  //   「端口开着但连不通 Google」——看起来像网络问题，其实是协议不匹配。
  for (const p of opens) {
    for (const 协议 of ['http', 'socks5']) {
      const url = 协议 + '://127.0.0.1:' + p;
      if (await proxyWorks(url)) {
        say('  ✓ ' + url + ' 能连通 Google，就用它');
        return { proxy: url, from: '自动探测（端口 ' + p + '，' + 协议.toUpperCase() + '）', tried };
      }
      tried.push(url + '（不通）');
    }
  }

  return { proxy: null, from: '找不到可用代理', tried };
}

/** 把定下来的代理写进环境变量，好让子进程与后续 require 都认得 */
function apply(proxy) {
  if (proxy) {
    process.env.HTTPS_PROXY = proxy;
    process.env.HTTP_PROXY = proxy;
  } else {
    delete process.env.HTTPS_PROXY;
    delete process.env.HTTP_PROXY;
    delete process.env.https_proxy;
    delete process.env.http_proxy;
  }
}

module.exports = { resolveProxy, apply, COMMON_PORTS, proxyWorks, directWorks, systemProxy };
