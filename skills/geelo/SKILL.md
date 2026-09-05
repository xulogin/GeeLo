---
name: geelo
description: Use when writing, debugging, or running Google Earth Engine (GEE) JavaScript — 遥感脚本、影像集合、NDVI/RSEI/LST 计算、Landsat/Sentinel/MODIS 数据处理、ee.ImageCollection / ee.Reducer / Map.addLayer / Export 相关代码，或用户提到 Earth Engine、Code Editor、GEE 脚本报错。GeeLo 让你在本机连真 Earth Engine 服务器把脚本跑一遍，自己看报错、自己改，跑通并核对数值之后再交付。仅支持 Windows。
---

# GeeLo · 本机跑通 GEE 再交付

**这个 skill 存在的唯一理由：GEE 代码写得对不对，静态审读看不出来。**

波段名、集合是不是空的、归约器要几个输入、行政区在数据集里叫什么——
`node --check` 全过，只有真连服务器才暴露。GeeLo 让你自己去跑。

## 工具在哪（下面写 `<GeeLo>` 的地方全指它）

**`<GeeLo>` = 本文件所在目录的上两级**（本文件是 `<GeeLo>/skills/geelo/SKILL.md`）。

- **Claude Code**：可以直接用 `${CLAUDE_PLUGIN_ROOT}`，它会自动展开成绝对路径
- **Codex / 其他环境**：`${CLAUDE_PLUGIN_ROOT}` **不会展开**。先把 `<GeeLo>` 算成
  实际绝对路径再执行，**不要把 `${...}` 原样敲进终端**
- **没装插件、直接 clone 的**：`<GeeLo>` 就是仓库根目录

无论哪种情况，**都不要问用户路径**——你自己能算出来。

---

## 第一步：先自检（每个新会话第一次用 GEE 时跑一次）

```bash
node "<GeeLo>/测试台/环境自检.js"
```

九项逐条报，按结果分三种处理：

| 结果 | 你怎么做 |
|---|---|
| 全部 `[通过]` | **直接开工，别汇报"我检查了环境"** |
| 缺 `@google/earthengine` | 自己跑 `npm install`（在 `<GeeLo>/测试台`，约 104 MB），装完继续 |
| 缺凭据 / 项目 ID 是占位符 | **跑认证**，见下 |

### 缺凭据或项目 ID —— 跑 `认证.js`，一条命令全解决

```bash
node "<GeeLo>/测试台/认证.js"
```

它会自动开浏览器 → 用户点一下「允许」→ 凭据自动写好 → 列出他的 Cloud 项目
→ 自动 `setx EE_PROJECT`。**不需要 Python，不需要用户复制任何东西。**

你要做的：

1. 跑上面这条命令，然后告诉用户「浏览器已经打开了，选你的 Google 账号点『允许』就行」
2. 它有多个项目、而你不在交互式终端时，它会**把项目清单打出来**。
   把清单给用户看，问他要哪个，然后：
   `node "<GeeLo>/测试台/认证.js" --project=<他选的ID>`
3. 认证完**提醒用户 `EE_PROJECT` 是 `setx` 写的，当前终端读不到**——
   你后续跑 `跑GEE.js` 时要么新开终端，要么在命令里临时带上
   `EE_PROJECT=<id>`（bash）/ `$env:EE_PROJECT='<id>';`（PowerShell）

★ **不要让用户把 `credentials` 的内容贴给你，也不要自己去读它、打印它。**
你只需要知道文件在不在。

★ 已经有凭据时它会拒绝覆盖。换账号或凭据失效才加 `--force`（旧的会自动备份）。

---

## ★ 四条铁律

### 1. 写完必须实跑验证再交付

```bash
node "<GeeLo>/测试台/跑GEE.js" --timeout 900 "<脚本绝对路径>"
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
node "<GeeLo>/测试台/跑GEE.js" --timeout 900 "<脚本.js>"

# 跑整个目录
node "<GeeLo>/测试台/跑GEE.js" --all "<目录>"

# 环境自检
node "<GeeLo>/测试台/环境自检.js"
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
- `<GeeLo>` 里的东西**别改**，那是插件本体

报告要给证据：说"跑通了"就附上实跑输出；跑不通就说跑不通，别粉饰。

---

## 可选：调通后送进 Code Editor

用户可能装了「功能二」，能把脚本推进他的 EE 仓库并弹出 Code Editor。

**先确认 `<GeeLo>/送进编辑器/配置.json` 存在**，不存在就别用，
直接把脚本路径交给用户。

```bash
# 迭代中：只推送不弹浏览器
node "<GeeLo>/送进编辑器/gee-open.js" "<脚本.js>" --no-browser

# 最终版：真开浏览器
node "<GeeLo>/送进编辑器/gee-open.js" "<脚本.js>"
```

规矩：**必须先跑通且数值检查通过**才允许推；**一个成果只推最终版一次**
（推送会在用户的 EE 仓库造提交）；**推完要在回复里明说**推到了哪个仓库、
标签页已经打开——用户要知道他的账号被写入了什么。

---

## 要更多细节时读这些

| 什么时候 | 读哪份 |
|---|---|
| 完整的八条铁律 / 目录地图 | `<GeeLo>/AGENTS.md` |
| 测试台报错看不懂、想知道它能查出什么 | `<GeeLo>/测试台/说明.md` |
| 为什么本机能跑 GEE（原理） | `<GeeLo>/测试台/原理.txt` |
| 右键功能出问题 / 凭据要换发 | `<GeeLo>/送进编辑器/说明.md` |
| 一个完整成果长什么样（含两个"跑通但结果错"的记录）| `<GeeLo>/示例脚本/RSEI_哨兵2_厦门岛.js` |

**别一上来全读**，按需取。

---

## 环境事实

- Windows + Node.js 20.19 以上（推荐 22 LTS）
- PowerShell 5.1 里 `&&` 不可用，用 `;` 或 `if ($?) { ... }`
- 代理测试台会自己找（配置.txt → 环境变量 → 直连 → 扫常见端口），一般不用管
- 凭据在 `%USERPROFILE%\.config\earthengine\credentials` 和 `%USERPROFILE%\.gitcookies`，
  **绝对不要打印、贴进对话或写进任何文件**
