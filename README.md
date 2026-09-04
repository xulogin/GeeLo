# GeeLo —— 用 AI 开发 GEE 的免干预工作流

**别再替 AI 调 GEE 脚本了。**

如果你用 AI 开发 Google Earth Engine，大概经历过这个循环：

```
你：帮我算 xx 区域 2019—2024 的 RSEI
AI：（十几秒，一整份 GEE JavaScript，注释齐全）
你：复制 → 粘进 Code Editor → Run → 报错
你：把报错复制回去 → AI 改 → 再复制 → 再粘 → 再 Run → 又报错
...
```

整个系统里最人肉的那个零件，是你。

**GeeLo 把这个零件去掉了。** 它让 AI 自己把脚本在本机连真服务器跑一遍：

```
写出来 → 自己跑 → 看服务器返回什么 → 发现错误 → 自己改 → 再跑 → 调通了才交给你
```

> **适配所有主流 AI 编程工具**（Claude Code、Codex、Cursor、Gemini CLI、Copilot、
> Cline、通义灵码……），不绑定任何一家——规矩写在通用的 `AGENTS.md` 里。

---

## 一、不是 AI 笨，是它写完没人批改

AI 写 GEE 代码的水平早就够用了，问题出在它写完之后——**不知道自己写得对不对**。

- 代码能跑通，结果却一直不对
- 访问不了 asset，属性字段名不对
- 老提示"配额限制"

这些问题的共同点：**语法完全正确，静态审读一律看不出来**。
因为它们压根不是语法问题，是"服务端"的问题——代码对不对，
只有在服务器上真正执行那张计算图、拿回结果才知道。

GeeLo 做的就是把那一步搬到本机，让 AI 自己去跑。

---

## 二、它长什么样

你只说一句话：

> "帮我写个南宁市 2019—2024 年 RSEI 生态质量评估的脚本。"

然后 AI 自己开始干活：

**① 写第一版 → ② 直接在本机连服务器跑**

```
▶ RSEI_南宁.js
      print: ① 年度影像数：  6
      print: ④ PC1 载荷：  【服务端报错】Image.select: Band pattern
             'p-value' did not match any bands.
             Available bands: [t_tau, t_p-value, NBR_tau, NBR_p-value]
```

**③ 报错了，它顺手写三行探针脚本，直接去问服务器：**

```js
print('kendallsCorrelation()  ：', 集合.reduce(ee.Reducer.kendallsCorrelation()).bandNames());
print('kendallsCorrelation(2) ：', 集合.reduce(ee.Reducer.kendallsCorrelation(2)).bandNames());
```

服务器把答案直接打在脸上，改完接着跑。

**④ 反复迭代，直到：**

```
   ── 小结 ──  耗时 22.4s　print 7　图层 3　导出 0
   ✓ 跑通，无报错无告警
```

**⑤（可选）调通之后，它自己把脚本推进你的 Earth Engine 仓库，并在你的 Chrome 里
弹出 Code Editor。**

体感就是：说完需求，过一会儿浏览器自己蹦出来一个标签页，
里面是已经验证过能跑的脚本。中间那些报错、探针、改了七版——你一个都不用看。

---

## 三、还有大招：跑通 ≠ 对

单纯的"能跑起来"不能证明"写得对"。AI 生成的代码往往写得很漂亮，
经过无数次抽打终于跑通了，但**结果真的对吗**？

GeeLo 能查出静态审读看不出来的一整类问题：

- 波段名写错（`B08` vs `B8`、`p-value` vs `NBR_p-value`）
- 归约器输入个数不对（`sensSlope` 要 2 个波段）
- 数组维度不匹配
- 过滤条件匹配不到（GAUL 里云南叫 `Yunnan Sheng`，不是 `Yunnan`）
- 内存和体积超限
- 稀疏数据抽样抽空
- **以及：跑通了但数值明显不合理**

> 真实案例（完整记录在 `示例脚本\RSEI_哨兵2_厦门岛.js` 的文件头）：
> 一次 RSEI 脚本「✓ 跑通，无报错无告警」，但 PC1 四个载荷全是正号——
> 物理上不可能，NDVI 与 NDBSI 实测相关 −0.93。
> 根因是 `ee.Reducer.centeredCovariance()` **不替你减均值**。
> 这类错误静态审读永远看不出来，跑通了也看不出来，**只有回头看数值才能发现**。

所以 `AGENTS.md` 的铁律第 2 条就是「跑通不等于对」，
要求 AI 交付前必须再看一层：数值合不合理、量级对不对、符号对不对。

---

## 四、还有个很现实的问题：配额

AI 有个"毛病"——它太勤快了。你让它 Debug，它是真能给你连着跑十几次。
但 GEE 的算力不是白来的，尤其是大范围遥感数据。

所以 `AGENTS.md` 的铁律第 4 条专门写了这个：**先拿一小块区域试、先测一个时间段、
先看几个样本，逻辑没问题了再逐步放大。**

---

## 五、装起来

### 5.0 先备齐这几样

| 需要 | 怎么确认 | 没有怎么办 |
|---|---|---|
| **Windows** | | 目前只支持 Windows（`.bat` + 注册表右键菜单） |
| **Node.js 20.19 以上** | `node -v` | https://nodejs.org/ 装 22 LTS 或更高 |
| **一个 GEE 账号 + 已注册的 Cloud 项目** | | https://code.earthengine.google.com 注册（学术用途免费） |
| **git**（只有功能二要） | `git --version` | https://git-scm.com/download/win |
| 能访问 Google | | 多数情况下不用管，测试台会自动找代理 |

### 5.1 装功能一：本地测试台（**核心，必装**）

```bat
git clone <本仓库地址> GeeLo
cd GeeLo
```

**第 1 步**：双击 `测试台\安装.bat`
　　　　　→ 查 Node 版本 → `npm install` 装依赖（约 104 MB）→ 跑环境自检

**第 2 步**：拿一次 GEE 凭据（**只需一次，以后不用 Python**）

```bat
pip install earthengine-api
earthengine authenticate
```

会开浏览器让你登录，登完在 `%USERPROFILE%\.config\earthengine\credentials`
留下一个长期有效的 `refresh_token`。测试台读的就是它。

**第 3 步**：填你自己的项目 ID

打开 `测试台\配置.txt`（记事本即可），把这一行换掉：

```
项目ID = ee-your-project-id        ← 这是占位符，必须改
```

在哪看自己的项目 ID：`code.earthengine.google.com` 右上角的项目选择器，
或 Assets 面板里 `projects/<这里就是>/assets/…`。

**第 4 步**：双击 `测试台\环境自检.bat`，全部 `[通过]` 就装好了。

> 自检会**逐项告诉你缺什么、怎么补**，不用回来翻文档。
> 实在搞不定：把自检的完整输出复制下来，连同 `测试台\说明.md` 一起丢给你的 AI 助手。

**第 5 步**：双击 `测试台\跑一个试试.bat` 看演示——
一个正常脚本（真连服务器取回结果）、一个故意写错的（看它怎么把 3 个错抓出来）。

### 5.2 装功能二：送进编辑器（**可选**）

只做一件事：把本地 `.js` 推进你的 EE 脚本仓库并打开 Code Editor。
不装也完全不影响功能一。

```
1. 双击 送进编辑器\设置.bat
     └─ 会停在「缺 git 凭据」，并自动用 Chrome 打开授权页
2. 页面上点 Generate Password → 选 Windows 标签页 → 整段复制
   → 粘进一个 cmd 窗口回车（★ 不要粘进 AI 对话框或任何聊天工具）
3. 再双击一次 设置.bat，这次会让你选仓库
4. 命令行跑：node gee-open.js --setup --repo=users/你的用户名/仓库名
5. 双击 注册右键菜单.bat
6. 右键 送进编辑器\示例\测试_能不能通.js →「以 GEE 打开」验一下
```

★ **第 4 步躲不掉**：EE **不支持 push 时自动建仓库**，而且**没有**官方文档说的
`users/<你>/default`。所以必须先在 Code Editor 里建一个
（Scripts 面板 → NEW → Repository），建议叫 `local-scripts`。

完整清单（含全新账号一个仓库都没有的情况）→ `送进编辑器\说明.md` 第八节。

---

## 六、日常怎么用

### 6.1 让 AI 写脚本

**在 GeeLo 目录里**开你的 AI 助手，直接提需求：

> "帮我写个基于哨兵二号求 RSEI 的脚本，研究区小一点"

不需要再说"你先了解一下这个项目"——`AGENTS.md`（以及 `CLAUDE.md` / `GEMINI.md`）
会被自动加载，AI 一上来就知道规矩是什么、命令怎么敲。

### 6.2 ★ 在**别的**文件夹干活（推荐这么用）

GeeLo 目录要保持干净稳定，**活应该在别处干**——那边有你的数据和资料。

做法**不是**把 GeeLo 复制过去，而是在你的工作文件夹里放一张"指路牌"：

```bat
:: 方式一：把文件夹拖到《新建工作区.bat》上
:: 方式二：命令行
node "<GeeLo 的绝对路径>\new-workspace.js" "D:\某个项目文件夹"
```

它会在那个文件夹里写三个小文件（`AGENTS.md` / `CLAUDE.md` / `GEMINI.md`），
内容是"工具在 ←这个绝对路径，规矩见那边"。
之后你在那个文件夹开 AI 助手，它一上来就知道全部背景。

**GeeLo 目录一个字都不会被改。** 想开几个工作区就开几个。

★ 里面写的是**绝对路径**。GeeLo 以后挪了位置，在每个工作区重跑一次这条命令即可
（加 `--force` 覆盖）。

### 6.3 自己手动跑测试台

```bat
:: 跑一个脚本（默认超时 300 秒，重的给 900）
node 测试台\跑GEE.js --timeout 900 "你的脚本.js"

:: 跑整个目录
node 测试台\跑GEE.js --all "某个目录"
```

⚠ **不要直接 `node 你的GEE脚本.js`** —— 会报 `ee is not defined`。
因为 `ee` / `print` / `Map` / `Export` 都是**运行环境提供的**，
`跑GEE.js` 的职责就是把它们注入进去再执行你的脚本。

### 6.4 右键送进 Code Editor（装了功能二才有）

**右键任意 `.js` → 「以 GEE 打开」**（Windows 11 可能要先点「显示更多选项」）。
约 2 秒后你平常那个 Chrome 弹出 Code Editor，**代码已经在编辑器里**。

三条规则：
1. **脚本名 = 文件名去掉 `.js`**，落在你选定的那个 EE 仓库下
2. **本地文件是唯一源头**，同名脚本会被覆盖；但**仓库里其他脚本绝对安全**
   （推送前会先 `fetch` 对齐服务端，只覆盖当前这一个）
3. **内容没变就不推送**，只重新打开页面

---

## 七、它到底怎么做到的（一句话原理）

客户端库 `@google/earthengine` **不做任何计算**，只把脚本里的 JS 调用拼成一段 JSON
（一张"计算图"）POST 给 Google，服务端算完返回 JSON。
所以"本地能不能跑 GEE"这个问题，等价于
**"这个 POST 发不发得出去、手上有没有有效的 token"**——与本机性能无关。

Code Editor 比这多出来的只有界面：`print` / `Map` / `Export` / `ui`，
**没有一样参与计算**。GeeLo 把这层外壳在本地补出来，其中
`print(x)` 被实现成**真的调 `x.getInfo()`**——这是整台机器唯一的发动机。

完整原理（含"为什么这件事以前一直没做成"）→ `测试台\原理.txt`。

---

## 八、安全边界

- **只读**：`Export.*` **只校验参数、不真导出**——不烧配额，不往你的 Drive / Asset
  写任何东西。整个测试台不改服务端任何数据。
- **沙箱**：待测脚本在 Node 的 `vm` 里执行，拿不到 `require` / `process` / `module`。
- **凭据不在这个仓库里**：
  EE 凭据在 `%USERPROFILE%\.config\earthengine\credentials`，
  git 凭据在 `%USERPROFILE%\.gitcookies`。
  **克隆、拷贝、分享本仓库不会泄露任何人的账号**；但每台新机器必须自己认证一次。
- **功能二写到哪**：只写你自己选定的那个 EE 脚本仓库；
  注册表只写 `HKCU`（当前用户），不需要管理员权限。
- ★ `.gitcookies` 里那一行 `1//0f……` **等同于你 EE 脚本仓库的钥匙**。
  它一旦出现在聊天记录、截图、邮件里就该换掉，而且**删本地文件不等于吊销**——
  必须去 `earthengine.googlesource.com/new-password` 点 Revoke。
  完整换发流程见 `送进编辑器\说明.md` 第八之二节。

---

## 九、卸载

```
双击 送进编辑器\取消右键菜单.bat        移除右键菜单项
删除 %LOCALAPPDATA%\GeeLo\             删掉本地克隆
在 earthengine.googlesource.com/new-password 吊销 git 密码
删除 %USERPROFILE%\.gitcookies          删掉本机 git 凭据
直接删掉整个 GeeLo 文件夹                删掉工具本身
```

★ 用 `新建工作区.bat` 在别处生成过的 `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` 要手动删。

---

## 十、目录结构

```
GeeLo\
├ README.md                  你正在读的这页（给人看）
├ AGENTS.md                  ★ 给所有 AI 的权威说明（八条铁律 + 常用命令）
├ CLAUDE.md                  Claude Code 的入口，指回 AGENTS.md
├ GEMINI.md                  Gemini CLI 的入口，指回 AGENTS.md
├ .github\copilot-instructions.md   Copilot 的入口，指回 AGENTS.md
├ new-workspace.js / 新建工作区.bat   ★ 在别的文件夹开工作区
│
├ 测试台\                     功能一（核心，必装）
│  ├ 说明.md                 用法、能查出什么、踩过的坑
│  ├ 原理.txt                它凭什么能在本机跑 GEE（接手必读）
│  ├ 配置.txt              ★ 换电脑通常只改这里的项目 ID
│  ├ 安装.bat              ★ 第一步：双击它
│  ├ 环境自检.bat             逐项体检，每项失败都告诉你怎么办
│  ├ 跑一个试试.bat            看演示
│  ├ 跑GEE.js 等程序本体
│  └ 示例\                   一个正常的、一个故意写错的
│
├ 送进编辑器\                 功能二（可选）
│  ├ 说明.md                 设计、方案对比、踩过的坑、换电脑清单
│  ├ 设置.bat              ★ 一次性设置
│  ├ 注册右键菜单.bat        ★ 加「以 GEE 打开」
│  └ 示例\测试_能不能通.js     装完先右键这个验通路
│
├ 示例脚本\RSEI_哨兵2_厦门岛.js   一个完整成果（含两个"跑通但结果错"的记录）
└ 文档\设计笔记_上下文注入.md      这套「AI 自动懂背景」怎么设计的
```

**只有这几个文件是"给人看 / 给人改"的**：三份 `说明.md`（读）、`原理.txt`（读）、
`测试台\配置.txt`（改）、几个 `.bat`（双击）。其余都是程序本体，正常不用动。

---

## 十一、许可

MIT，见 `LICENSE`。
