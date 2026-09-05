/**
 * 代理 agent 工厂 —— 所有要走代理的地方**共用这一份**
 * ============================================================================
 * 为什么单独抽出来：以前 跑GEE.js / 环境自检.js / 认证.js / xhr代理.js / 代理探测.js
 * 各自写了一遍 `new HttpsProxyAgent(url)`，五处。结果就是**加一种协议要改五个地方**，
 * 漏一个就出现"自检说代理能用、真跑却连不上"这种最难查的不一致。
 * （同 配置读取.js 的教训，那份注释里写着一模一样的话。）
 *
 * ★ 支持两种协议，缺一不可：
 *   · http://  —— HTTP CONNECT，`https-proxy-agent`
 *   · socks5://（socks4/socks5h 同理）—— `socks-proxy-agent`
 *
 *   为什么必须支持 SOCKS：v2rayN 默认开的 **10808 是 SOCKS**，10809 才是 HTTP；
 *   而且很多人只开了 SOCKS 那一个。只认 HTTP 的话，表现是
 *   「端口开着、但连不通 Google」——看起来像网络问题，其实是协议不匹配。
 *   （这个坑是别人装的时候踩出来的，2026-09-05）
 */
'use strict';

/** 这个代理地址是不是 SOCKS。没写协议头的一律当 HTTP。 */
function isSocks(url) {
  return /^socks/i.test(String(url || ''));
}

/**
 * 按代理地址造一个 agent。
 * @param {string|null} url 代理地址，如 http://127.0.0.1:7890 或 socks5://127.0.0.1:10808
 * @returns {object|undefined} 没有代理、或依赖没装齐时返回 undefined（等同直连）
 */
function makeAgent(url) {
  if (!url) { return undefined; }
  try {
    if (isSocks(url)) {
      const { SocksProxyAgent } = require('socks-proxy-agent');
      return new SocksProxyAgent(url);
    }
    const { HttpsProxyAgent } = require('https-proxy-agent');
    return new HttpsProxyAgent(url);
  } catch (e) {
    // 依赖没装齐（还没 npm install）时不要炸，让调用方按"直连"继续，
    // 真正的缺依赖报错交给 环境自检.js 第 2 项去说。
    return undefined;
  }
}

/** 从环境变量现读代理。★ 不要在模块加载时读死——代理是启动后探测出来才写进去的。 */
function proxyFromEnv() {
  return process.env.HTTPS_PROXY || process.env.https_proxy
      || process.env.HTTP_PROXY || process.env.http_proxy || null;
}

/** 按环境变量造 agent（最常用的那个组合）。 */
function agentFromEnv() { return makeAgent(proxyFromEnv()); }

/**
 * 给子进程用的一段代码：把 makeAgent 的逻辑内联进去。
 * xhr代理.js 的同步请求是 `node -e` 起子进程发的，那边 require 不到本模块的相对路径，
 * 所以这里把两个包的**绝对路径**解析好再拼进去。
 * @returns {string} 一段 JS 源码，定义了 makeAgent(url)
 */
function 子进程代码片段() {
  let httpsPath = '', socksPath = '';
  try { httpsPath = require.resolve('https-proxy-agent'); } catch (e) { /* 没装 */ }
  try { socksPath = require.resolve('socks-proxy-agent'); } catch (e) { /* 没装 */ }
  return `
function makeAgent(url){
  if(!url) return undefined;
  try{
    if(/^socks/i.test(url)){
      if(!${JSON.stringify(socksPath)}) return undefined;
      const {SocksProxyAgent}=require(${JSON.stringify(socksPath)});
      return new SocksProxyAgent(url);
    }
    if(!${JSON.stringify(httpsPath)}) return undefined;
    const {HttpsProxyAgent}=require(${JSON.stringify(httpsPath)});
    return new HttpsProxyAgent(url);
  }catch(e){ return undefined; }
}
`;
}

module.exports = { makeAgent, isSocks, proxyFromEnv, agentFromEnv, 子进程代码片段 };
