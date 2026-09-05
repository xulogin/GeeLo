# GeeLo —— 用 AI 开发 GEE 的免干预工作流

**别再替 AI 调 GEE 脚本了。**

用 AI 写 Google Earth Engine，你大概经历过这个循环：

```
你：帮我算 xx 区域 2019—2024 的 RSEI
AI：（一整份 GEE JavaScript，注释齐全）
你：复制 → 粘进 Code Editor → Run → 报错 → 把报错复制回去 → 再改 → 再粘 → 又报错……
```

整个系统里最人肉的那个零件，是你。**GeeLo 把这个零件去掉了**——
让 AI 自己在本机连真 Earth Engine 服务器把脚本跑一遍：

```
写出来 → 自己跑 → 看服务器返回什么 → 发现错误 → 自己改 → 再跑 → 调通了才交给你
```

**能查出静态审读看不出来的那一类问题**：波段名写错、集合是空的、归约器输入个数不对、
过滤条件匹配不到、内存超限，**以及跑通了但数值明显不合理**。

> 一句话原理：客户端库 `@google/earthengine` 不做任何计算，只把脚本拼成一段 JSON
> POST 给 Google。所以"本地能不能跑 GEE"等价于"这个 POST 发不发得出去"，与本机性能无关。
> 完整版见 `测试台\原理.txt`。

---

## 适配哪些工具

规矩写在通用的 `AGENTS.md` 里，**不绑定任何一家**：

| 工具 | 怎么生效 |
|---|---|
| **Claude Code** | 装插件即可，任意文件夹随开随用（见下方安装 ①） |
| Codex / Cursor / Cline / 通义灵码 / Zed | 自动读 `AGENTS.md` |
| Gemini CLI | 自动读 `GEMINI.md` → 指回 `AGENTS.md` |
| GitHub Copilot | 自动读 `.github/copilot-instructions.md` |

**环境要求**：Windows、Node.js 20.19+（推荐 22 LTS）、一个 GEE 账号和已注册的 Cloud 项目。

---

## 怎么装

### ① Claude Code / Codex（各两条命令）

```
Claude Code:   /plugin marketplace add xulogin/GeeLo
               /plugin install geelo@geelo

Codex:         codex plugin marketplace add xulogin/GeeLo
               codex plugin add geelo@geelo
```

**装完直接提需求就行。** 第一次用时 AI 会自己跑环境检查、自己装依赖；
需要认证时**浏览器会自动弹出来，你点一下「允许」就完事**——
不用装 Python，不用复制令牌，项目 ID 也会自动配好。

### ② Gemini CLI / Cursor / Cline（没有插件市场）

```bat
git clone https://github.com/xulogin/GeeLo.git
cd GeeLo
```

1. 双击 `测试台\安装.bat`　　　查 Node → 装依赖（约 104 MB）
2. 双击 `测试台\认证.bat`　　　浏览器弹出 → 点「允许」→ 凭据和项目 ID 自动配好
3. 双击 `测试台\环境自检.bat`　全部 `[通过]` 就装好了
4. `node 全局安装.js`　　　　　装全局指路牌，之后**任意文件夹随开随用**

**装不上？** 把 `环境自检.bat` 的完整输出丢给你的 AI 助手——它会逐项告诉你缺什么、怎么补。

### ③ 可选：右键「以 GEE 打开」

把本地 `.js` 推进你的 EE 仓库并弹出 Code Editor。不装不影响主功能。
步骤见 `送进编辑器\说明.md`。

---

## 怎么用

**你只要说话。**

> "帮我写个基于哨兵二号求厦门岛 RSEI 的脚本，研究区小一点"

剩下的它自己干：写第一版 → 在本机连真服务器跑 → 看服务端报什么 → 改 →
再跑 → 核对数值合不合理 → 才交给你。**中间那些命令都是 AI 自己敲的，你一条都不用输。**

Claude Code 里还可以用斜杠命令：

```
/geelo 帮我算南宁 2019—2024 的 RSEI     带需求 = 直接开工
/geelo                                   不带参数 = 体检，告诉你缺什么
```

**在哪个文件夹用**：装了插件的（Claude Code / Codex）任意文件夹都行。
跑过 `全局安装.js` 的（Gemini CLI）也是任意文件夹。
都没有的话，给某个工作文件夹单独放一张指路牌：

```bat
node "<GeeLo绝对路径>\new-workspace.js" "D:\某个项目文件夹"
```

**安全边界**：`Export.*` 只校验参数不真导出（不烧配额、不写你的 Drive/Asset）；
脚本在 `vm` 沙箱里跑；全程只读。凭据在你的用户目录里，**不在这个仓库**——
克隆或分享本仓库不会泄露账号。

---

### 附：手动跑测试台（一般用不到，AI 自己会跑）

```bat
node 测试台\跑GEE.js --timeout 900 "你的脚本.js"     :: 跑一个
node 测试台\跑GEE.js --all "某个目录"                :: 跑一整个目录
node 测试台\认证.js --force                          :: 换账号 / 凭据失效了
```

⚠ 不要直接 `node 你的GEE脚本.js` —— 会报 `ee is not defined`。
`ee` / `print` / `Map` / `Export` 都是运行环境提供的，`跑GEE.js` 负责注入它们。

---

## 想深入

| 什么时候 | 读哪份 |
|---|---|
| 给 AI 的权威说明（八条铁律、常用命令、目录地图）| `AGENTS.md` |
| 测试台能查出什么、报错看不懂 | `测试台\说明.md` |
| 它凭什么能在本机跑 GEE | `测试台\原理.txt` |
| 右键功能、换账号、凭据泄露要换发 | `送进编辑器\说明.md` |
| 一个完整成果（含两个"跑通但结果错"的真实记录）| `示例脚本\RSEI_哨兵2_厦门岛.js` |
| 这套「AI 自动懂背景」怎么设计的 | `文档\设计笔记_上下文注入.md` |
| 为什么做成插件、边界怎么划的 | `文档\设计笔记_做成Claude插件.md` |

---

## 作者与许可

**Haifeng Xu**　<xuhf@swfu.edu.cn>　·　**MIT**（见 `LICENSE`）

用它做出了东西、或者踩到了坑，欢迎开 Issue。
