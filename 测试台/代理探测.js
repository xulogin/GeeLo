/**
 * 代理探测 —— 让工具自己找到本机代理，不用每次 set 环境变量
 * ============================================================================
 * 为什么需要：双击 .bat 开的是全新 cmd 窗口，**不继承**你在别处 set 过的
 * HTTPS_PROXY。结果就是"命令行里跑得好好的，一双击就连不上 Google"。
 *
 * 解决顺序（与下面 resolveProxy() 的实现严格一致，改代码要同步改这里）：
 *   ① 配置.txt 里的「代理 = ...」（写死，最可靠）
 *   ② 环境变量 HTTPS_PROXY / HTTP_PROXY
 *   ③ **先试直连** —— 有些网络本来就不需要代理，别绕远路
 *   ④ **自动探测**：挨个试常见的本机代理端口，哪个能连通 Google 就用哪个
 *   都不行 → 返回「找不到可用代理」，由调用方提示用户
 *
 * ★ 每一级都不是"看着像就采信"：端口开着不算数，必须真的 HEAD 通
 *   oauth2.googleapis.com 才算数。
 */
'use strict';

const net = require('net');
const https = require('https');

// 常见代理软件的默认本地端口（按常见程度排序）
const COMMON_PORTS = [
  10808,  // v2rayN / v2rayA  HTTP
  10809,  // v2rayN 另一个常用口
  7890,   // Clash / Clash for Windows
  7897,   // Clash Verge
  1080,   // 通用
  8080,   // 通用
  8888,   // Fiddler / Charles
  2080,   // Nekoray
  10000,
];

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
    let agent;
    try {
      const { HttpsProxyAgent } = require('https-proxy-agent');
      agent = new HttpsProxyAgent(url);
    } catch (e) { return res(false); }
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

  // ③ 先试直连——不需要代理的网络就别绕了
  say('  正在试直连…');
  if (await directWorks(5000)) {
    return { proxy: null, from: '直连（不需要代理）', tried };
  }
  say('  ✗ 直连不通，开始扫本机常见代理端口…');

  // ④ 扫常见端口。先并发筛出"开着的"，再逐个验证能不能真的连 Google
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

  for (const p of opens) {
    const url = 'http://127.0.0.1:' + p;
    if (await proxyWorks(url)) {
      say('  ✓ ' + url + ' 能连通 Google，就用它');
      return { proxy: url, from: '自动探测（端口 ' + p + '）', tried };
    }
    tried.push(url + '（端口开着但连不通 Google）');
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

module.exports = { resolveProxy, apply, COMMON_PORTS, proxyWorks, directWorks };
