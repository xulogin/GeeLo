/**
 * GeeLo · GEE 脚本本地测试台
 * ============================================================================
 * 用途：把 GEE 的 JavaScript **原样**拿到本机跑，真连 Earth Engine 服务器，
 *      用来发现"波段名写错、集合是空的、归约器参数个数不对"这类只有实跑才暴露的问题。
 *      —— 不再需要人工打开 Code Editor 一个个粘贴。
 *
 * 原理：Code Editor 里的 print / Map / Export / ui 是编辑器提供的界面外壳，
 *      npm 上的 @google/earthengine 只有计算部分。本文件把那层外壳补上：
 *        · print(x)            → 真的对 x 调 getInfo()，把结果打到终端（**会真算**，所以能报错）
 *        · Map.addLayer(x,...) → 不画图，但对 x 取 bandNames + 投影，验证它算得出来
 *        · Export.*            → 不真导出（会烧配额），只校验参数并打印
 *
 * 用法：
 *      node 测试台\跑GEE.js <脚本.js>
 *      node 测试台\跑GEE.js --all <目录>            （跑整个目录里的 .js）
 *      node 测试台\跑GEE.js --timeout 600 <文件>    （单脚本超时秒数，默认 300）
 *
 * 认证：复用 earthengine 命令行早先存下的 %USERPROFILE%\.config\earthengine\credentials，
 *      不需要每次登录。项目 ID 读同目录的 配置.txt，也可用环境变量 EE_PROJECT 覆盖。
 *      令牌过期会自动续（refresh_token 换 access_token）。
 *
 * 注意：**本工具只读地跑脚本，不导出、不写 Asset、不动任何服务端数据。**
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const https = require('https');
const http = require('http');
const querystring = require('querystring');

// ---------------------------------------------------------------- 代理
// 代理在 main() 里**自动探测**（配置.txt → 环境变量 → 扫本机常见端口 → 直连），
// 探到的结果写进 process.env，xhr代理.js 每次现读，所以这里不用先设。
// 之所以不能只依赖环境变量：双击 .bat 开的是全新 cmd，不继承你在别处 set 的值。

// ★ EE 客户端用的是 npm 包 xmlhttprequest，它**不读代理**、同步请求还另起子进程，
//   打 globalAgent 补丁对它无效（实测 status 恒为 0）。换成自己实现的走代理版本。
//
//   光设 global.XMLHttpRequest 不够——@google/earthengine 的 build\main.js 第 2 行是
//   `const XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;`，它自己会覆盖回去。
//   所以这里**拦截模块加载**：谁 require('xmlhttprequest')，都拿到我们的实现。
//   这样不用改 node_modules，npm 重装也不会丢。
const { ProxyXHR } = require('./xhr代理.js');
global.XMLHttpRequest = ProxyXHR;
const Module = require('module');
const _load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'xmlhttprequest') return { XMLHttpRequest: ProxyXHR };
  return _load.apply(this, arguments);
};

const ee = require('@google/earthengine');

// 项目 ID：环境变量 EE_PROJECT → 同目录 配置.txt → 内置占位符（故意连不上）。
// ★ 解析逻辑在 配置读取.js，与 环境自检.js **共用同一份**，避免两处规则漂移。
const { readProject } = require('./配置读取.js');
const _proj = readProject(__dirname);
const PROJECT = _proj.value;
// earthengine 命令行工具自带的公开 client（与 Python 版 ee.oauth 里的一致）
const CLIENT_ID = '517222506229-vsmmajv00ul0bs7p89v5m89qs8eb9359.apps.googleusercontent.com';
const CLIENT_SECRET = 'RUP0RZ6e0pPhDzsqIJ7KlNd1';

// ---------------------------------------------------------------- 认证
function getAccessToken() {
  const credPath = path.join(os.homedir(), '.config', 'earthengine', 'credentials');
  if (!fs.existsSync(credPath)) {
    throw new Error('找不到凭据 ' + credPath
      + '\n先跑一次认证（自动开浏览器，点「允许」就完事，不用装 Python）：'
      + '\n  node "' + path.join(__dirname, '认证.js') + '"');
  }
  const refresh = JSON.parse(fs.readFileSync(credPath, 'utf8')).refresh_token;
  const body = querystring.stringify({
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
    refresh_token: refresh, grant_type: 'refresh_token',
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      // ★ 现建代理 agent：代理是 main() 里探测出来、写进 process.env 的，
      //   不能用 https.globalAgent（那是没打过补丁的默认 agent，会直连然后超时）。
      agent: require('./代理agent.js').agentFromEnv(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.access_token) resolve(j);
          else reject(new Error('换取令牌失败：' + d.slice(0, 300)));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

// ---------------------------------------------------------------- 结果收集
const R = { print: 0, layer: 0, exp: 0, warn: [], err: [] };

function short(v, n) {
  n = n || 260;
  let s;
  try { s = typeof v === 'string' ? v : JSON.stringify(v); } catch (e) { s = String(v); }
  if (s === undefined) s = String(v);
  return s.length > n ? s.slice(0, n) + ' …' : s;
}

/** 真正触发服务端计算，把服务端报错原样抓出来 */
function evaluate(x, label) {
  if (x && typeof x.getInfo === 'function') {
    try {
      return { ok: true, value: x.getInfo() };
    } catch (e) {
      const msg = (e && e.message) || String(e);
      R.err.push(label + '　→　' + msg);
      return { ok: false, error: msg };
    }
  }
  return { ok: true, value: x };
}

// ---------------------------------------------------------------- Code Editor 外壳
function makeShims(tag) {
  const P = (...a) => console.log('   ' + tag + ' ' + a.join(' '));

  const shimPrint = function () {
    R.print++;
    const parts = [];
    for (const a of arguments) {
      if (a && typeof a.getInfo === 'function') {
        const r = evaluate(a, 'print#' + R.print);
        parts.push(r.ok ? short(r.value) : '【服务端报错】' + short(r.error, 200));
      } else {
        parts.push(short(a));
      }
    }
    P('print:', parts.join('  '));
  };

  const Map = {
    addLayer(x, vis, name) {
      R.layer++;
      // 不画图，但要确认这层**真的算得出来**——实测最容易错的就是这里
      if (x && typeof x.bandNames === 'function') {
        const r = evaluate(x.bandNames(), 'addLayer(' + (name || R.layer) + ').bandNames');
        if (r.ok) {
          if (Array.isArray(r.value) && r.value.length === 0) {
            R.warn.push('图层「' + (name || R.layer) + '」是**零波段影像**——多半是空集合取了 median()');
          }
          P('addLayer:', (name || '(未命名)'), '波段', short(r.value, 150));
        } else {
          P('addLayer:', (name || '(未命名)'), '【算不出来】');
        }
      } else if (x && typeof x.size === 'function') {
        const r = evaluate(x.size(), 'addLayer(' + (name || R.layer) + ').size');
        P('addLayer:', (name || '(未命名)'), '要素数', short(r.value, 60));
      } else {
        P('addLayer:', (name || '(未命名)'));
      }
      return this;
    },
    centerObject() { return this; },
    setCenter() { return this; },
    setOptions() { return this; },
    style() { return { set() {} }; },
    layers() { return { reset() {}, add() {}, get() { return {}; } }; },
    onClick() {}, unlisten() {}, remove() {}, add() {}, clear() {},
    drawingTools() { return { onDraw() {}, layers() { return []; }, setShape() {}, draw() {} }; },
    getBounds() { return null; }, getCenter() { return null; }, getScale() { return 100; },
  };

  const mkTask = (kind) => function (args) {
    R.exp++;
    const a = args || {};
    const name = a.description || a.fileNamePrefix || a.assetId || '(未命名)';
    // 只校验，不真导出——真导出会烧配额，且会往你自己的 Drive/Asset 里写东西
    const missing = [];
    if (!a.region && kind !== 'table') missing.push('region');
    if (!a.scale && !a.crsTransform && kind !== 'table') missing.push('scale 或 crsTransform');
    if (a.maxPixels === undefined && kind !== 'table') {
      R.warn.push('Export「' + name + '」没写 maxPixels，大区域会中途失败');
    }
    if (missing.length) R.warn.push('Export「' + name + '」缺参数：' + missing.join('、'));
    P('Export.' + kind + ':', name, '（已跳过实际导出）');
    return { start() {} };
  };

  const Export = {
    image: { toDrive: mkTask('image'), toAsset: mkTask('image'), toCloudStorage: mkTask('image') },
    table: { toDrive: mkTask('table'), toAsset: mkTask('table'), toCloudStorage: mkTask('table') },
    video: { toDrive: mkTask('video') },
    map:   { toCloudStorage: mkTask('map') },
  };

  // ui.* 全是界面部件，本地跑不需要真画，但**每个方法都要能链式调用**，
  // 否则脚本会挂在 `ui.Chart.image.series(...).setOptions(...)` 这种链上（踩过一次）。
  const widget = () => {
    const w = new Proxy({}, {
      get(_, k) {
        if (k === 'then' || k === Symbol.toPrimitive || typeof k === 'symbol') return undefined;
        if (k === 'getValue') return () => null;
        if (k === 'widgets') return () => ({ reset() {}, add() {}, get: () => w, length: 0 });
        if (k === 'style') return () => ({ set: () => w, get: () => null });
        return (...a) => w;          // 其余一律返回自身，保证链式调用不断
      },
    });
    return w;
  };
  const ui = {
    Label: widget, Button: widget, Panel: widget, Slider: widget, Select: widget,
    Textbox: widget, Checkbox: widget, Chart: Object.assign(widget, {
      image: { series: widget, seriesByRegion: widget, doySeries: widget, histogram: widget,
               regions: widget, byRegion: widget, byClass: widget },
      array: { values: widget },
      feature: { byFeature: widget, byProperty: widget, groups: widget, histogram: widget },
      setOptions: widget,
    }),
    Map: function () { return Map; },
    root: { add() {}, clear() {}, widgets() { return { reset() {}, add() {} }; } },
    url: { get() {}, set() {} },
    util: { clear() {}, debounce: (f) => f, throttle: (f) => f },
    Key: {}, Chart2: {},
  };

  return { print: shimPrint, Map, Export, ui };
}

// ---------------------------------------------------------------- 跑一个脚本
function runOne(file, timeoutSec) {
  const name = path.basename(file);
  console.log('');
  console.log('='.repeat(78));
  console.log('▶ ' + name);
  console.log('='.repeat(78));

  R.print = 0; R.layer = 0; R.exp = 0; R.warn = []; R.err = [];

  const src = fs.readFileSync(file, 'utf8');

  // ★ 这里**故意不做任何"要不要跑"的猜测**：你交给它的每个 .js 都会真跑。
  //   早期版本按文件名/正文关键词跳过过一类脚本，结果是"什么都没跑却报了个成功"——
  //   静默跳过比跑错更难查。要排除某个文件，别把它放进 --all 的目录里就是了。

  const shims = makeShims('  ');
  const sandbox = Object.assign({
    ee, console,
    require: undefined, process: undefined, module: undefined, // 不给脚本碰宿主
    Math, JSON, Date, Number, String, Array, Object, Boolean, RegExp, Error,
    parseInt, parseFloat, isNaN, isFinite,
    setTimeout, clearTimeout,
  }, shims);
  sandbox.globalThis = sandbox;

  const t0 = Date.now();
  let fatal = null;
  try {
    vm.runInNewContext(src, vm.createContext(sandbox), {
      filename: name, timeout: timeoutSec * 1000,
    });
  } catch (e) {
    fatal = (e && e.message) || String(e);
  }
  const sec = ((Date.now() - t0) / 1000).toFixed(1);

  console.log('');
  console.log('   ── 小结 ──  耗时 ' + sec + 's　print ' + R.print
              + '　图层 ' + R.layer + '　导出 ' + R.exp);
  if (fatal) console.log('   ✗ 脚本中断：' + fatal.slice(0, 400));
  R.err.forEach(e => console.log('   ✗ 服务端报错：' + e.slice(0, 300)));
  R.warn.forEach(w => console.log('   ⚠ ' + w));
  if (!fatal && !R.err.length && !R.warn.length) console.log('   ✓ 跑通，无报错无告警');

  return { file: name, sec: +sec, fatal, errs: R.err.slice(), warns: R.warn.slice(),
           prints: R.print, layers: R.layer };
}

// ---------------------------------------------------------------- 主流程
(async function main() {
  const argv = process.argv.slice(2);
  let timeoutSec = 300, all = false;
  const targets = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--all') all = true;
    else if (argv[i] === '--timeout') {
      const v = +argv[++i];
      if (!isFinite(v) || v <= 0) {
        console.log('--timeout 后面要跟秒数，例如 --timeout 1200');
        process.exit(1);
      }
      timeoutSec = v;
    }
    else targets.push(argv[i]);
  }
  if (!targets.length) {
    console.log('用法：node 跑GEE.js <脚本.js>');
    console.log('      node 跑GEE.js --all <目录>');
    console.log('      node 跑GEE.js --timeout 900 <脚本.js>   （默认 300 秒）');
    process.exit(1);
  }

  const files = [];
  for (const t of targets) {
    const p = path.resolve(t);
    if (fs.statSync(p).isDirectory()) {
      fs.readdirSync(p).filter(f => f.endsWith('.js')).sort()
        .forEach(f => files.push(path.join(p, f)));
    } else files.push(p);
  }

  if (_proj.warn) {
    console.log('⚠ ' + _proj.warn);
    console.log('  （设项目 ID：node "' + path.join(__dirname, '认证.js') + '" --project=<你的项目ID>）');
  }
  // ★ 先找一条能通 Google 的路
  const { readProxy } = require('./配置读取.js');
  const { resolveProxy, apply } = require('./代理探测.js');
  const pr = await resolveProxy(readProxy(__dirname), null);
  apply(pr.proxy);
  console.log('联网方式：' + (pr.proxy ? pr.proxy + '（' + pr.from + '）' : pr.from));
  if (!pr.proxy && pr.from.indexOf('直连') !== 0) {
    console.log('⚠ 没找到能连通 Google 的方式，下面多半会失败。');
    console.log('  先双击 环境自检.bat 看具体缺什么。');
  }

  console.log('正在连接 Earth Engine（项目 ' + PROJECT
              + '，来自' + _proj.from + '）…');
  const tok = await getAccessToken();
  await new Promise((res, rej) => {
    ee.data.setAuthToken('', 'Bearer', tok.access_token, tok.expires_in, [], () => {
      ee.data.setProject(PROJECT);
      ee.initialize(null, null, res, rej, null, PROJECT);
    }, false);
  });
  console.log('已连接。共 ' + files.length + ' 个脚本，单脚本超时 ' + timeoutSec + 's。');

  const results = [];
  for (const f of files) results.push(runOne(f, timeoutSec));

  console.log('');
  console.log('='.repeat(78));
  console.log('总表');
  console.log('='.repeat(78));
  let bad = 0;
  for (const r of results) {
    const n = (r.fatal ? 1 : 0) + r.errs.length;
    if (n) bad++;
    console.log('  ' + (n ? '✗' : (r.warns.length ? '⚠' : '✓')) + ' ' + r.file
      + '　' + r.sec + 's　报错 ' + n + '　告警 ' + r.warns.length);
  }
  console.log('');
  console.log(bad ? ('★ ' + bad + ' 个脚本有报错，见上') : '★ 全部脚本无报错');
  process.exit(bad ? 1 : 0);
})().catch(e => {
  const m = String((e && e.message) || e);
  console.error('');
  console.error('启动失败：' + m);
  console.error('');
  // 把最常见的几种失败翻译成中文处置建议——新机器上最需要的就是这个
  if (/Cannot find module/.test(m)) {
    console.error('→ 依赖没装。在本目录（' + __dirname + '）执行：  npm install');
  } else if (/ERR_REQUIRE_ESM/.test(m)) {
    console.error('→ Node 版本太老（当前 v' + process.versions.node + '）。');
    console.error('  依赖 https-proxy-agent 是纯 ESM 包，需要 Node 20.19+ / 22 LTS 以上。');
  } else if (/invalid_grant/.test(m)) {
    console.error('→ 凭据失效了。重新认证：  node "' + path.join(__dirname, '认证.js') + '" --force');
  } else if (/invalid_client/.test(m)) {
    console.error('→ CLIENT_ID/SECRET 不对。它们是 earthengine-api 的公开值，');
    console.error('  正常不用改；若被误改过，见《说明.md》坑 3。');
  } else if (/not found or deleted|does not exist/i.test(m)) {
    // ★ 排在网络类之前：项目不存在被误导去查代理，最费时间。
    console.error('→ 项目「' + PROJECT + '」不存在。');
    if (PROJECT === require('./配置读取.js').PLACEHOLDER) {
      console.error('  这是发布时的**占位符**，你还没填自己的项目 ID。');
    }
    console.error('  设项目 ID：node "' + path.join(__dirname, '认证.js') + '" --project=<你的项目ID>');
    console.error('  在哪看：code.earthengine.google.com 右上角的项目选择器。');
  } else if (/not registered|not signed up/i.test(m)) {
    console.error('→ 项目「' + PROJECT + '」没注册 Earth Engine。');
    console.error('  设项目 ID：node "' + path.join(__dirname, '认证.js') + '" --project=<你的项目ID>');
  } else if (/permission/i.test(m)) {
    console.error('→ 对项目「' + PROJECT + '」没权限，多半这不是你的项目。');
    console.error('  设项目 ID：node "' + path.join(__dirname, '认证.js') + '" --project=<你的项目ID>');
  } else if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|Failed to contact/i.test(m)) {
    console.error('→ 网络不通。这台机器访问 Google 可能要走代理：');
    console.error('    set HTTPS_PROXY=http://127.0.0.1:端口');
    console.error('  已设代理的话，确认代理软件在运行、端口对不对。');
  } else if (/找不到凭据/.test(m)) {
    console.error('→ 按上面提示做完，再跑一次。');
  }
  console.error('');
  console.error('★ 拿不准就双击本目录的  环境自检.bat  ，它会逐项告诉你缺什么、怎么补。');
  console.error('');
  process.exit(2);
});
