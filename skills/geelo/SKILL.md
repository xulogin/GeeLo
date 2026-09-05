---
name: geelo
description: Use when writing, debugging, or running Google Earth Engine (GEE) JavaScript — 遥感脚本、影像集合、NDVI/RSEI/LST 计算、Landsat/Sentinel/MODIS 数据处理、ee.ImageCollection / ee.Reducer / Map.addLayer / Export 相关代码，或用户提到 Earth Engine、Code Editor、GEE 脚本报错。GeeLo 让你在本机连真 Earth Engine 服务器把脚本跑一遍，自己看报错、自己改，跑通并核对数值之后再交付。仅支持 Windows。
---

# GeeLo · 本机跑通 GEE 再交付

**这个 skill 存在的唯一理由：GEE 代码写得对不对，静态审读看不出来。**

波段名、集合是不是空的、归约器要几个输入、行政区在数据集里叫什么——
`node --check` 全过，只有真连服务器才暴露。GeeLo 让你自己去跑。

工具在 `${CLAUDE_PLUGIN_ROOT}`，下面所有命令直接用这个变量，**不要问用户路径**。

---

## 第一步：先自检（每个新会话第一次用 GEE 时跑一次）

```bash
node "${CLAUDE_PLUGIN_ROOT}/测试台/环境自检.js"
```

九项逐条报，按结果分三种处理：

| 结果 | 你怎么做 |
|---|---|
| 全部 `[通过]` | **直接开工，别汇报"我检查了环境"** |
| 缺 `@google/earthengine` | 自己跑 `npm install`（在 `${CLAUDE_PLUGIN_ROOT}/测试台`，约 104 MB），装完继续 |
| 缺凭据 / 项目 ID 是占位符 | **停下来交给用户**，见下方两条 |

### 缺凭据 —— 你替不了，让用户自己敲

```
pip install earthengine-api
earthengine authenticate
```

要开浏览器登录 Google，之后再也不需要 Python。

★ **不要让用户把 `credentials` 的内容贴给你，也不要自己去读它、打印它。**
你只需要知道文件在不在。

### 项目 ID 还是占位符 —— 让用户设环境变量

```bat
setx EE_PROJECT ee-他自己的项目id
```

**用环境变量，不要改 `配置.txt`**——那个文件在插件目录里，`/plugin update` 会冲掉。
项目 ID 在哪看：`code.earthengine.google.com` 右上角项目选择器，
或 Assets 面板里 `projects/<这里就是>/assets/…`。

设完要**新开一个终端**才生效。

---

## ★ 四条铁律

### 1. 写完必须实跑验证再交付

```bash
node "${CLAUDE_PLUGIN_ROOT}/测试台/跑GEE.js" --timeout 900 "<脚本绝对路径>"
```

**不许只做静态审读就说"应该没问题"。** 没跑过的脚本不算交付。

### 2. 「跑通」不等于「对」

GEE 是**惰性计算**，`print` / `Map.addLayer` / `Export` 才触发真算。三个推论：

- 语法检查毫无用处
- **报错行号往往不是有 bug 的行**（错误统一在 `print` 那一刻爆出来）
- **零报错也可能全错**

> 真事：一次 RSEI 脚本「✓ 跑通，无报错无告警」，但 PC1 四个载荷全是正号——
> 物理上不可能，NDVI 与 NDBSI 实测相关 −0.93。
> 根因是 `ee.Reducer.centeredCovariance()` **不替你减均值**。
> 静态审读看不出来，跑通了也看不出来，**只有回头看数值才能发现**。

所以交付前一定要再问自己：**这些数字讲得通吗？量级对吗？符号对吗？**

### 3. 不确定就写探针问服务器，不要猜

"我记得应该是……"一律改成三行探针实测。比查文档快，也比记忆可靠。

```js
print('A) kendallsCorrelation()  ：', 集合.reduce(ee.Reducer.kendallsCorrelation()).bandNames());
print('B) kendallsCorrelation(2) ：', 集合.reduce(ee.Reducer.kendallsCorrelation(2)).bandNames());
```

探针脚本写到**临时目录**，不要留在用户的文件夹里。

### 4. 省配额：先小后大

GEE 算力不是白来的。Debug 阶段**先拿一小块区域、先测一个时间段、先看几个样本**，
逻辑通了再逐步放大。每轮 Debug 都直接怼整个研究区，成本高得吓人。

---

## 常用命令

```bash
# 跑一个脚本（默认超时 300 秒，重的给 900）
node "${CLAUDE_PLUGIN_ROOT}/测试台/跑GEE.js" --timeout 900 "<脚本.js>"

# 跑整个目录
node "${CLAUDE_PLUGIN_ROOT}/测试台/跑GEE.js" --all "<目录>"

# 环境自检
node "${CLAUDE_PLUGIN_ROOT}/测试台/环境自检.js"
```

退出码：`0` 无报错 / `1` 有脚本报错 / `2` 启动阶段就失败（依赖、Node 版本、凭据、网络）。

⚠ **不要直接 `node 用户的GEE脚本.js`** —— 会报 `ee is not defined`。
`ee` / `print` / `Map` / `Export` 都是运行环境提供的，`跑GEE.js` 的职责就是注入它们。

**安全边界**：`Export.*` 只校验参数不真导出（不烧配额、不写用户的 Drive/Asset）；
脚本在 Node 的 `vm` 沙箱里跑，拿不到 `require` / `process`；全程只读。

---

## 别污染用户的文件夹

- 探针、临时脚本、中间产物 → **临时目录**
- 成果脚本 → 当前工作区，**一个成果一个文件**
- `${CLAUDE_PLUGIN_ROOT}` 里的东西**别改**，那是插件本体

报告要给证据：说"跑通了"就附上实跑输出；跑不通就说跑不通，别粉饰。

---

## 可选：调通后送进 Code Editor

用户可能装了「功能二」，能把脚本推进他的 EE 仓库并弹出 Code Editor。

**先确认 `${CLAUDE_PLUGIN_ROOT}/送进编辑器/配置.json` 存在**，不存在就别用，
直接把脚本路径交给用户。

```bash
# 迭代中：只推送不弹浏览器
node "${CLAUDE_PLUGIN_ROOT}/送进编辑器/gee-open.js" "<脚本.js>" --no-browser

# 最终版：真开浏览器
node "${CLAUDE_PLUGIN_ROOT}/送进编辑器/gee-open.js" "<脚本.js>"
```

规矩：**必须先跑通且数值检查通过**才允许推；**一个成果只推最终版一次**
（推送会在用户的 EE 仓库造提交）；**推完要在回复里明说**推到了哪个仓库、
标签页已经打开——用户要知道他的账号被写入了什么。

---

## 要更多细节时读这些

| 什么时候 | 读哪份 |
|---|---|
| 完整的八条铁律 / 目录地图 | `${CLAUDE_PLUGIN_ROOT}/AGENTS.md` |
| 测试台报错看不懂、想知道它能查出什么 | `${CLAUDE_PLUGIN_ROOT}/测试台/说明.md` |
| 为什么本机能跑 GEE（原理） | `${CLAUDE_PLUGIN_ROOT}/测试台/原理.txt` |
| 右键功能出问题 / 凭据要换发 | `${CLAUDE_PLUGIN_ROOT}/送进编辑器/说明.md` |
| 一个完整成果长什么样（含两个"跑通但结果错"的记录）| `${CLAUDE_PLUGIN_ROOT}/示例脚本/RSEI_哨兵2_厦门岛.js` |

**别一上来全读**，按需取。

---

## 环境事实

- Windows + Node.js 20.19 以上（推荐 22 LTS）
- PowerShell 5.1 里 `&&` 不可用，用 `;` 或 `if ($?) { ... }`
- 代理测试台会自己找（配置.txt → 环境变量 → 直连 → 扫常见端口），一般不用管
- 凭据在 `%USERPROFILE%\.config\earthengine\credentials` 和 `%USERPROFILE%\.gitcookies`，
  **绝对不要打印、贴进对话或写进任何文件**
