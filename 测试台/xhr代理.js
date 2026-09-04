/**
 * 走代理的 XMLHttpRequest（给 @google/earthengine 在 Node 里用）
 * ============================================================================
 * 为什么需要它：
 *   EE 的 JS 客户端在 Node 里用的是 npm 包 `xmlhttprequest`。那个包
 *   ① 不读 HTTPS_PROXY，② 同步请求是另起子进程做的，所以给 https.globalAgent
 *   打代理补丁对它**完全无效**（实测 status 一直是 0）。
 *   这台机器访问 Google 必须走本地代理，因此自己实现一个。
 *
 * 支持：
 *   · 异步请求 —— https.request + HttpsProxyAgent
 *   · 同步请求 —— spawnSync 起一个子进程去发（EE 的 getInfo() 走这条）
 *   · 只实现 goog.net.XhrIo 真正用到的那几个成员，够用即可
 *
 * 没有设代理的机器上，agent 为 undefined，等同直连，行为不变。
 */
'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { spawnSync } = require('child_process');

// ★ 每次现读，不要在模块加载时读死。
//   因为启动流程是「先 require 本模块 → 再自动探测代理 → 写进 process.env」，
//   读死的话探测结果对本模块完全无效（表现为：自检探到了代理，请求还是超时）。
function currentProxy() {
  return process.env.HTTPS_PROXY || process.env.https_proxy
      || process.env.HTTP_PROXY || process.env.http_proxy || null;
}

function makeAgent() {
  const PROXY = currentProxy();
  if (!PROXY) return undefined;
  const { HttpsProxyAgent } = require('https-proxy-agent');
  return new HttpsProxyAgent(PROXY);
}

// 子进程里跑的代码：发一次请求，把结果按 JSON 吐到 stdout
const CHILD = `
const https=require('https'), http=require('http');
let buf=''; process.stdin.on('data',d=>buf+=d); process.stdin.on('end',()=>{
  const o=JSON.parse(buf);
  let agent;
  if(o.proxy){ const {HttpsProxyAgent}=require(${JSON.stringify(require.resolve('https-proxy-agent'))});
               agent=new HttpsProxyAgent(o.proxy); }
  const u=new URL(o.url);
  const mod = u.protocol==='https:' ? https : http;
  const req=mod.request({hostname:u.hostname, port:u.port||undefined,
      path:u.pathname+u.search, method:o.method, headers:o.headers, agent, timeout:180000},res=>{
    const chunks=[]; res.on('data',c=>chunks.push(c));
    res.on('end',()=>{ process.stdout.write(JSON.stringify({
        status:res.statusCode, headers:res.headers,
        body:Buffer.concat(chunks).toString('utf8')})); });
  });
  req.on('error',e=>process.stdout.write(JSON.stringify({status:0,error:String(e&&e.message||e),body:''})));
  req.on('timeout',()=>{req.destroy(new Error('timeout'));});
  if(o.body) req.write(o.body);
  req.end();
});
`;

function requestOnce(opts) {
  const r = spawnSync(process.execPath, ['-e', CHILD], {
    input: JSON.stringify({ ...opts, proxy: currentProxy() }),
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,   // getInfo 可能返回很大的 JSON
    timeout: 300000,
  });
  if (r.error) return { status: 0, error: String(r.error.message), body: '', headers: {} };
  try {
    return JSON.parse(r.stdout || '{}');
  } catch (e) {
    return { status: 0, error: '子进程返回无法解析：' + String(r.stdout).slice(0, 200)
                              + ' / stderr:' + String(r.stderr).slice(0, 200),
             body: '', headers: {} };
  }
}

// ★ 长时间的计算（几百秒的 getInfo）经本地代理时偶尔会被掐断，
//   EE 客户端把它报成 "Failed to contact Earth Engine servers"，看起来像代码错，其实不是。
//   这里对**网络层失败**重试 3 次；服务端返回的业务错误（4xx/5xx 带 JSON）不重试，
//   因为那才是我们要抓的真问题。（2026-08-18 实跑 E5/E8 时踩到）
function requestSync(opts) {
  let last = null;
  for (let i = 0; i < 3; i++) {
    last = requestOnce(opts);
    const netFail = !last.status || last.status === 0
      || last.status === 502 || last.status === 503 || last.status === 504;
    if (!netFail) return last;
    if (i < 2) {
      const wait = 3000 * (i + 1);
      spawnSync(process.execPath, ['-e', `setTimeout(()=>{},${wait})`], { timeout: wait + 4000 });
    }
  }
  return last;
}

class ProxyXHR {
  constructor() {
    this.readyState = 0;
    this.status = 0;
    this.statusText = '';
    this.responseText = '';
    this.response = '';
    this.onreadystatechange = null;
    this.onload = null;
    this.onerror = null;
    this.ontimeout = null;
    this.timeout = 0;
    this.withCredentials = false;
    this._headers = {};
    this._resHeaders = {};
    this._aborted = false;
  }

  open(method, url, async) {
    this._method = (method || 'GET').toUpperCase();
    this._url = String(url);
    this._async = async !== false;
    this.readyState = 1;
    this._fire();
  }

  setRequestHeader(k, v) { this._headers[k] = v; }

  getResponseHeader(k) {
    const v = this._resHeaders[String(k).toLowerCase()];
    return v === undefined ? null : (Array.isArray(v) ? v.join(', ') : v);
  }

  getAllResponseHeaders() {
    return Object.keys(this._resHeaders)
      .map(k => k + ': ' + this._resHeaders[k]).join('\r\n');
  }

  abort() { this._aborted = true; this.readyState = 0; }

  _fire() { if (typeof this.onreadystatechange === 'function') this.onreadystatechange(); }

  _finish(res) {
    if (this._aborted) return;
    this.status = res.status || 0;
    this.statusText = res.status ? String(res.status) : (res.error || 'error');
    this.responseText = res.body || '';
    this.response = this.responseText;
    this._resHeaders = res.headers || {};
    this.readyState = 4;
    this._fire();
    if (this.status >= 200 && this.status < 300) {
      if (typeof this.onload === 'function') this.onload();
    } else if (typeof this.onerror === 'function') {
      this.onerror(new Error(res.error || ('HTTP ' + this.status)));
    }
  }

  send(body) {
    const opts = { url: this._url, method: this._method,
                   headers: this._headers, body: body || null };

    if (!this._async) {            // ← EE 的 getInfo() 走这条
      this._finish(requestSync(opts));
      return;
    }

    const u = new URL(this._url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname, port: u.port || undefined,
      path: u.pathname + u.search, method: this._method,
      headers: this._headers, agent: makeAgent(), timeout: this.timeout || 180000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => this._finish({
        status: res.statusCode, headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', e => this._finish({ status: 0, error: String(e && e.message || e), body: '' }));
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  }
}

ProxyXHR.UNSENT = 0; ProxyXHR.OPENED = 1; ProxyXHR.HEADERS_RECEIVED = 2;
ProxyXHR.LOADING = 3; ProxyXHR.DONE = 4;

module.exports = { ProxyXHR, currentProxy, makeAgent };
