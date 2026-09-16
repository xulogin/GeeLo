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

> 要在 GEE 上跑**神经网络**、或者要**逐像元的不确定性 σ**（随机森林给不出）？
> 那是姊妹项目 [**GeeDL**](https://github.com/xulogin/GeeDL) 的活。
> **数据太大下不动、下载太慢**？那是 [**GeeZip**](https://github.com/xulogin/GeeZip) 的活。
> 两个都把 GeeLo 当前置依赖。普通 GEE 脚本留在这儿就行。

---

## ★ 先说清楚：这是一个 skill，不是一个能双击运行的软件

本项目是一个**给 AI 用的 skill（工作流）**，它本身不写脚本，也不替你出图——
**它给 AI 补上"自己动手验证"这个能力**，脚本是 AI 写的，验证是它自己跑的。

所以它**必须配合 AI 使用**（Claude Code、Codex 等）。单独 clone 下来当软件用，
你只会看到一堆脚本，不知道该点哪个。

## 最简单的用法

**一、让 AI 装上它。** 打开 Claude Code 或 Codex，直接说：

> 安装 https://github.com/xulogin/GeeLo

**二、直接提需求。** 比如：

> 帮我写个基于哨兵二号求厦门岛 RSEI 的脚本，研究区小一点

剩下的它自己干：写第一版 → 在本机连真服务器跑 → 看服务端报什么 → 改 →
再跑 → 核对数值合不合理 → 才交给你。

**中间那些命令都是 AI 自己敲的，你一条都不用输。** 第一次用时它会自己装依赖；
需要认证时**浏览器会自动弹出来，你点一下「允许」就完事**——
不用装 Python，不用复制令牌，项目 ID 也会自动配好。

## 手动装（可选）

想自己装也行，两条命令：

```text
Claude Code:   /plugin marketplace add https://github.com/xulogin/GeeLo.git
               /plugin install geelo@geelo

Codex:         codex plugin marketplace add https://github.com/xulogin/GeeLo.git
               codex plugin add geelo@geelo
```

需要 Windows、Node.js 20.19+（推荐 22 LTS）、一个 GEE 账号和已注册的 Cloud 项目，
以及能正常访问 GitHub 和 Earth Engine 的网络。
（国内基本都要开代理——GeeLo 本来就要连 `earthengine.googleapis.com`，
代理是这套东西的前提，不是为装插件额外加的负担。）

**用别的 AI 工具？** Gemini CLI / Cursor / Cline 没有插件市场，
`git clone` 下来之后让你的 AI 跑一次 `node 全局安装.js` 就行，之后任意文件夹随开随用。
通义灵码 / Zed / GitHub Copilot 会自动读仓库里的 `AGENTS.md`。
规矩写在通用的 `AGENTS.md` 里，**不绑定任何一家**。

---

## 一句话原理

客户端库 `@google/earthengine` 不做任何计算，只把脚本拼成一段 JSON POST 给 Google。
所以"本地能不能跑 GEE"等价于"这个 POST 发不发得出去"，**与本机性能无关**。
完整版见 `测试台\原理.txt`。

## Claude Code 里的斜杠命令

```
/geelo 帮我算南宁 2019—2024 的 RSEI     带需求 = 直接开工
/geelo                                   不带参数 = 体检，告诉你缺什么
```

## 安全边界

`Export.*` 只校验参数不真导出（**不烧配额、不写你的 Drive/Asset**）；
脚本在 `vm` 沙箱里跑；全程只读。凭据在你的用户目录里，**不在这个仓库**——
克隆或分享本仓库不会泄露账号。

## 可选：右键「以 GEE 打开」

把本地 `.js` 推进你的 EE 仓库并弹出 Code Editor。不装不影响主功能，
步骤见 `送进编辑器\说明.md`。

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

## 姊妹项目

| | 管什么 |
|---|---|
| **GeeLo** | 就是本项目。写和调普通 GEE 脚本，让 AI 连真服务器跑通了再交付 |
| [GeeDL](https://github.com/xulogin/GeeDL) | 在 GEE 上跑神经网络，输出预测值和**逐像元不确定性 σ** |
| [GeeZip](https://github.com/xulogin/GeeZip) | 数据太大下不动时，**云上先压好再下载**，回本地还原 |

三个都是 skill，用法一样：让 AI 装上，然后提需求。
后两个都以 GeeLo 为前置依赖，装的时候缺什么它们自己会拉。

## 作者与许可

**Haifeng Xu**　<hifengxu@gmail.com>　·　**MIT**（见 `LICENSE`）

用它做出了东西、或者踩到了坑，欢迎开 Issue。
