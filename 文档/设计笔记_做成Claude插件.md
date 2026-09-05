# 设计笔记 · 做成 Claude Code 插件

> 记录 GeeLo 长出「插件 / skill」这层外壳的设计：**为了解决什么、边界划在哪、
> 哪些东西刻意没做。**
>
> 这份不是使用说明（那在根目录的 `README.md`），是**决策记录**。
> 前置阅读：`设计笔记_上下文注入.md`——本文是那套机制的延伸，不是替代。

---

# 一、要解决的问题：分发链路太长

工具本身早就能用了，卡住的是**别人怎么装上**。现在的链路是：

```
读 README → git clone → 进目录 → 双击 安装.bat（npm install 104 MB）
→ earthengine authenticate → 改 配置.txt 填项目 ID
→ 每个工作文件夹再跑一次 new-workspace.js 埋指路牌
```

七步。其中**六步是纯机械操作**，而且每一步都能劝退一个人。

真正躲不掉的只有一步：`earthengine authenticate`——它要开浏览器登录 Google 账号，
这件事任何工具都替不了用户做。

**所以目标很具体：把六步机械操作压成两条命令，把那一步躲不掉的做成"不用查文档"。**

---

# 二、方案选型：三条路，为什么选现在这条

| | A（选中） | B | C |
|---|---|---|---|
| 做法 | 现有 GeeLo 仓库里加一层插件外壳 | 新建 GeeLo-skill 仓库，只放薄 skill，指向用户自己 clone 的 GeeLo | 新建 GeeLo-skill 仓库，把 GeeLo 整个复制进去 |
| 装几步 | 2 条命令，工具本体随插件一起到位 | **3 步**：先 clone，再装 skill，还要告诉 skill 工具在哪 | 2 条命令 |
| 维护 | 一份代码 | 一份代码，但版本要对得上 | **两份代码手动同步** |

**B 直接和目标打架**——它把一步装变成三步装，为了"仓库名好看"付出的代价太大。

**C 迟早翻车**：skill 里写的命令和工具的实际行为会漂移。这个项目里早有先例，
`配置读取.js` 的注释就写着"以前两个文件各抄了一份解析逻辑，结果出现过
'自检说没配置、跑GEE 却读得到'的怪事"。同一个道理放大到仓库层面。

**A 成立的关键前提**：本仓库很小——36 个跟踪文件、`.git` 只有 299 KB
（`node_modules` 不进版本库）。所以"工具本体随插件一起分发"几乎零成本。
如果仓库有几百兆，这个方案就不成立了。

★ 顺带一条命名决策：**仓库名保持 `GeeLo`，不叫 `GeeLo-skill`。**
一个项目两个仓库，会让人在第一步就选错。

---

# 三、新增什么（现有 36 个文件一个都不动）

```
GeeLo/
├ .claude-plugin/
│  ├ marketplace.json     ← 让 xulogin/GeeLo 自己就是一个 marketplace
│  └ plugin.json          ← 插件元数据（geelo / MIT / Haifeng Xu）
├ skills/geelo/SKILL.md   ← 唯一新增的「内容」文件
└ （README.md 加一小节，AGENTS.md 加两行，其余原样）
```

`marketplace.json` 里 `"source": "./"`，即**仓库根就是插件根**。
装完之后 `测试台\跑GEE.js`、`环境自检.js`、`示例\` 全都在插件目录里现成可用。

用户侧两条命令：

```
/plugin marketplace add https://github.com/xulogin/GeeLo.git
/plugin install geelo
```

★ **非 Claude 用户完全不受影响**：多出来的三个文件他们看不见也用不着，
`git clone` 那条路一个字节都没变。这是硬约束——README 第一句"适配所有主流 AI 编程工具"
是这个项目的立身之本，不能为了 Claude 用户的便利把它牺牲掉。

---

# 四、★ 核心决策：SKILL.md 写什么、不写什么

沿用 `设计笔记_上下文注入.md` 第四节那条原则——**指路，不要复制**。
`CLAUDE.md → AGENTS.md` 已经是桩式设计，skill 是同一个模式再套一层。

**AGENTS.md 仍然是唯一权威源。SKILL.md 不复制它。**

但"全部指路"也不对：skill 触发后如果只说一句"去读 AGENTS.md"，等于多一次文件读取，
而且 AI 未必真去读（这个风险在上一份设计笔记第七节就记过）。

所以按**使用频率**切：

| 内联进 SKILL.md | 指路到 AGENTS.md |
|---|---|
| 铁律 1　必须实跑验证再交付 | 铁律 5　别污染用户文件夹 |
| 铁律 2　跑通 ≠ 对（含 `centeredCovariance` 那个案例）| 铁律 6　`.bat` 必须纯 ASCII |
| 铁律 3　不确定就写探针问服务器 | 铁律 7　报告要给证据 |
| 铁律 4　先小后大省配额 | 铁律 8　送进编辑器的五条规矩 |
| 常用命令（全部用 `${CLAUDE_PLUGIN_ROOT}`）| 各份 `说明.md` / `原理.txt` |

**判据：每次写脚本都要用的内联，出问题才查的指路。**

前四条是这套工具存在的全部理由，值得占那点上下文；
铁律 6 只有在写 `.bat` 时才相关，铁律 8 要先确认功能二装没装，
这些按需读就够。

★ 一条容易搞反的：**铁律 2 的那个真实案例（PC1 四个载荷全是正号）必须内联，
不能只写"跑通不等于对"。** 抽象的规矩 AI 会点头然后照样违反，
带具体翻车案例的规矩才有约束力。这也是 AGENTS.md 本身的写法。

---

# 五、首次使用：skill 自己带用户装

skill 触发后**第一件事是跑自检**，而不是问用户装没装：

```
node "${CLAUDE_PLUGIN_ROOT}/测试台/环境自检.js"
```

`环境自检.js` 本来就是为这个场景写的——九项逐条报，每项失败都附怎么补。
skill 只需要按它的输出分三种情况处理：

| 自检结果 | skill 怎么做 |
|---|---|
| 全部 `[通过]` | 直接开工，不废话，不报告"我检查了环境" |
| 缺 `@google/earthengine` | **自己跑** `npm install`（在插件目录，约 104 MB），装完继续 |
| 缺凭据 / 项目 ID 是占位符 | 跑 `认证.js`（自动弹浏览器），让用户点一下「允许」（见十二）|

★ 后两种的分界线是：**能不能在不碰用户账号的前提下做完。**
`npm install` 和跑 `认证.js` 都能（认证.js 只是把浏览器弹出来），
只有「在浏览器里点允许」这一下必须用户自己做。
AGENTS.md 已明令"不要让用户把 credentials 贴给你，也不要自己去读它"，
SKILL.md 里必须重申，因为 skill 的使用者可能从没读过 AGENTS.md。

---

# 六、★ 一个真实的坑：插件更新会冲掉项目 ID

`配置.txt` 在插件目录里。`/plugin update` 一拉，用户填的项目 ID 就没了——
这是纯插件方案独有的问题，clone 方案不存在（用户改的是自己的工作副本）。

好在 `配置读取.js:45-51` 已经把 **`EE_PROJECT` 环境变量排在 `配置.txt` 前面**：

```js
if (process.env.EE_PROJECT) {
  return { value: process.env.EE_PROJECT, from: '环境变量 EE_PROJECT', warn: null };
}
```

所以插件路径下的解法是**零代码改动**——引导用户走环境变量：

```bat
setx EE_PROJECT ee-your-real-project
```

配置存在用户环境里，插件怎么更新都不受影响；`环境自检.js` 会照实报
"来自 环境变量 EE_PROJECT"，不会有歧义。

★ **刻意没做**：给 `配置读取.js` 加一层 `%USERPROFILE%\.geelo\配置.txt` 兜底。
现有优先级已经够用，加一层查找路径就多一处要解释、要自检、要写进文档的东西。
等真有人抱怨环境变量不好使再说。

★ 同理，`npm install` 装进插件目录（`~/.claude/plugins/cache/...`）是**刻意的**：
卸载插件时依赖跟着一起消失，不留垃圾。代价是 `/plugin update` 换版本目录后
要重装一次——由 skill 的自检流程自动兜住，用户无感。

---

# 七、README 重写：砍到只剩「适配谁 / 怎么装 / 怎么用」

现在的 README 有 380 行，一半是论述"为什么值得装"。**砍掉。**

理由不是"短的好看"，是**分工**：README 是给第一次点进仓库的陌生人看的落地页，
它只需要让人在一分钟内判断"这东西关不关我事、怎么装上"。
论述、踩坑、原理，`测试台\说明.md`、`原理.txt`、`送进编辑器\说明.md`
和本目录下的两份设计笔记本来就写全了——README 指路过去就行，不要重讲一遍。

目标结构（控制在 100 行内）：

```
GeeLo —— 用 AI 开发 GEE 的免干预工作流
├ 它干什么          那个「写→跑→报错→改」的循环，加一句话原理　（≤15 行）
├ 适配哪些工具      一张表：Claude Code / Codex / Cursor / Gemini CLI /
│                   Copilot / Cline / 通义灵码 —— 规矩写在通用 AGENTS.md 里
├ 怎么装            ① Claude Code：两条命令
│                   ② 其他工具：clone + 安装.bat + 认证 + 项目ID
│                   （每条按 5 行以内写，装不上就指路到 环境自检.bat）
├ 怎么用            在任意文件夹提需求就行；另附手动跑测试台的两条命令
└ 想深入            一张指路表：说明.md / 原理.txt / 设计笔记
```

被移走的内容各归各家，**一个字都不新写**：

| 原 README 章节 | 去处 |
|---|---|
| 一、二、三、四（为什么值得装、跑通≠对、配额）| 压成开头几行；完整版在 `AGENTS.md` 铁律 2 和 4 |
| 五（装起来的完整分步）| 压成"怎么装"两条路；细节归 `测试台\说明.md` |
| 七（一句话原理）| 留一句，完整版指路 `测试台\原理.txt` |
| 八（安全边界）| 留一行"只读、不烧配额、凭据不在仓库里"，细节指路 |
| 九（卸载）、十（目录结构）| 删；目录地图 `AGENTS.md` 里已有一份 |

★ **别把插件宣传成"零配置"。** 躲不掉的那步认证如果不提前说清楚，
用户装到一半卡住，体感比一开始就知道要认证更差。

各步骤的真实变化：

| 步骤 | 手动安装 | 插件安装 |
|---|---|---|
| `git clone` + 找目录 | 要 | 免 |
| 双击 `安装.bat` 跑 `npm install` | 要 | 免（skill 自检发现缺依赖就装）|
| 拿凭据 | 要装 Python | 免（认证.js 自动弹浏览器，点一下就行）|
| 填项目 ID | 改 `配置.txt` | `setx EE_PROJECT`，skill 带着做 |
| `new-workspace.js` 埋指路牌 | 每个工作文件夹一次 | 免（skill 全局可用）|

★ 别把它宣传成"零配置"。躲不掉的那一步如果不提前说清楚，
用户装到一半卡住，体感比一开始就知道要认证更差。

---

# 八、skill 与 `new-workspace.js` 的关系：并存，不替代

`new-workspace.js` **不删**。两者覆盖不同人群：

| | 指路牌（`new-workspace.js`）| skill |
|---|---|---|
| 覆盖 | 所有 AI 工具 | Claude Code 与 Codex |
| 生效范围 | 埋过牌的那个文件夹 | 全局任意目录 |
| 额外好处 | 可以手工加**本工作区特有的约定** | 无 |

最后一条是 skill 替代不了的：工作区的 `AGENTS.md` 可以写"本项目的数据在
`./raw/`、坐标系统一用 EPSG:4326"这类只对这个项目成立的规矩。
skill 是全局的，写不了这种东西。

**所以 Claude 用户在一个长期项目里，两个一起用才是最优解**：
skill 提供工具知识，指路牌提供项目知识。

---

# 九、验收标准

- [ ] `/plugin marketplace add https://github.com/xulogin/GeeLo.git` + `/plugin install geelo@geelo` 两条命令装完
- [ ] 在一个**跟 GeeLo 毫无关系的空文件夹**里说"帮我写个厦门岛 NDVI 脚本"，
      Claude 自动加载 skill、自己找到 `跑GEE.js`、跑通再交付——**全程用户没输过任何路径**
- [ ] 环境没配好时，skill 能把用户带到全部 `[通过]`，且**没有**要求用户贴凭据内容
- [ ] `/plugin update` 之后项目 ID 仍然有效（走环境变量）
- [ ] `git clone` 那条老路径**行为不变**——非 Claude 用户零影响

---

# 十、已知局限（诚实记下来）

| 局限 | 影响 | 缓解 |
|---|---|---|
| skill 只在 Claude Code / Codex 生效 | Cursor / Cline / Copilot 用不上 | AGENTS.md + 指路牌那条路原样保留（见十一）|
| 认证要用户在浏览器点一次「允许」| 装到一半要人工介入一次 | 已压到最小：认证.js 自动弹浏览器，不用装 Python、不用复制（见十二）|
| 依赖装在插件目录 | `/plugin update` 换版本目录后要重装 104 MB | skill 自检自动兜住，用户无感 |
| `配置.txt` 会被更新覆盖 | 填在文件里的项目 ID 会丢 | 引导用 `EE_PROJECT` 环境变量 |
| 仍然只支持 Windows | 非 Windows 用户装了也用不了 | 插件描述里写明；这是工具本身的限制，不是插件层的 |

---

# 十一、后来发现：Codex 也能装，而且**读的是同一份清单**

本文前面写"skill 是 Claude Code 生态特性"，这条**已经过时了**，如实更正。

Codex 有自己的插件系统（`codex plugin marketplace add` / `codex plugin add`），
而且实测发现：**它直接读 `.claude-plugin/marketplace.json`**——不用另写一份。
只需要补一个 `.codex-plugin/plugin.json`，里面用 `"skills": "./skills/"`
指向同一个 skills 目录。

```
codex plugin marketplace add https://github.com/xulogin/GeeLo.git
codex plugin add geelo@geelo
```

实测（`codex exec` 问它）：

> 有，当前可用 `geelo:geelo` skill。
> 写完 GEE 脚本后，必须用 GeeLo 连接真实 Earth Engine 服务器实际运行一遍。

它不但看得见 skill，还能准确复述铁律 1。

★ 一个**必须处理**的坑：`${CLAUDE_PLUGIN_ROOT}` 在 Codex 里**不会展开**。
所以 SKILL.md 里不能再依赖那个变量，改成写 `<GeeLo>`，并在开头交代它怎么算出来：
「本文件所在目录的上两级」。AI 总是知道自己读的文件在哪，所以这个判据到哪都成立。
**任何依赖单一厂商特性的写法，都要配一条通用的退路**——这条在
`设计笔记_上下文注入.md` 第四节就写过，这里又验证了一次。

于是覆盖面变成：

| 工具 | 怎么装 | 任意文件夹可用 |
|---|---|---|
| Claude Code | 两条命令 | ✅ |
| Codex | 两条命令 | ✅ |
| Gemini CLI | clone + `全局安装.js` | ✅ |
| Cursor / Cline | clone + 粘一段进设置 | ✅ |
| Copilot | clone + `new-workspace.js` | 只在埋过牌的仓库 |

---

# 十二、干掉 Python：`测试台\认证.js`

原来的安装卡在这三条命令上：

```
pip install earthengine-api
earthengine authenticate
setx EE_PROJECT ee-xxx
```

为了拿一次凭据装一整套 Python，这是整个安装流程里最劝退的一步。

**拆开看，`earthengine authenticate` 只干两件事**：①开浏览器拿一个 authorization
code ②拿它换 refresh_token 存进凭据文件。而第②步 `跑GEE.js` 早就自己实现了——
它每次启动都在用 refresh_token 换 access_token，用的就是 earthengine 命令行那个
**公开 client**（`跑GEE.js:64`）。

**所以只差第①步。** 补上它，Python 就整个不需要了。

★ 而且能比"复制授权码"更省一步：凭据文件里的 `redirect_uri` 是
`http://localhost:8085`——这个 client 本来就走**本地回环**。在本机起一个一次性
小服务器接住回调，用户点完「允许」浏览器自己跳回来，**什么都不用复制**。

顺带把项目 ID 也解决了：认证时申请的 scope 里有 `cloud-platform`，
所以拿到 token 之后可以直接列出用户的 Cloud 项目让他选，然后替他 `setx EE_PROJECT`。

最终安装流程：

```
两条命令装插件 → 提需求 → 浏览器自动弹出 → 点「允许」→ 完事
```

## 实现上踩到的两个点

**① 未处理拒绝会杀进程。** `等授权()` 返回的 Promise 如果在调用者 `await` 之前
就被 reject（用户点了「取消」），Node 15+ 会把它当成未处理拒绝**直接终止进程**。
解法是在服务器起来的同时就把 Promise 建好，并挂一个空 `catch` 兜底——
它处理的是**派生**的那个 Promise，原来那个照样把错误交给真正 await 它的人。
这个 bug 是写测试时抓到的，不是想出来的。

**② 已有凭据默认不覆盖。** 凭据等同于账号钥匙，误覆盖的代价太大。
默认拒绝，要覆盖得显式 `--force`，而且旧的先备份。
（同 `new-workspace.js` 的 `--force` 设计，理由见另一份设计笔记 5.4。）

## 刻意没做

- **不自己注册 OAuth client**。复用 earthengine 命令行那个公开 client，
  产出的凭据文件与 `earthengine authenticate` **完全兼容**，两边可以互换——
  用户想回去用 Python 那套，或者本来就有凭据，都不受影响。
  自己注册一个的话要走 Google 的应用验证，否则用户会看到「未验证的应用」警告。

---

# 十三、一句话总结

**AGENTS.md 是权威源，skill 是给 Claude 用户的一条捷径入口——
捷径可以更短，但不能另说一套。**
