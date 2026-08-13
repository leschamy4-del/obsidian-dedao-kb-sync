# 得到大脑知识库同步（Dedao Brain KB Sync）

一个面向**得到大脑（原 Get 笔记）会员**的 Obsidian 社区插件：把笔记与订阅的抖音博主内容同步到 Obsidian，**按知识库自动建文件夹并打标签**。

> 本插件衍生自 [AndyZhengyan/obsidian-dedao-brain-sync](https://github.com/AndyZhengyan/obsidian-dedao-brain-sync)（MIT 协议）。在原生同步能力之上，重点补齐了「按知识库组织」这一核心能力，并保留原项目的：知识库勾选、定时同步、附件导入、增量同步、断点续传、反向写回、搜索等全部能力。

---

## 核心能力

| 能力 | 说明 |
| --- | --- |
| **库同步** | 设置里勾选要同步的「得到大脑」知识库，并为**每个库指定落到 Obsidian 的文件夹**（默认用库原生名） |
| **自动导入** | 同步时按库名建文件夹，笔记自动归入对应库文件夹，并给每条笔记写入 `kb` 属性 + `#知识库/<库名>` 标签 |
| **定时同步** | 可设置自动同步开关、间隔（分钟）、启动时同步 |
| **抖音博主** | 订阅的抖音博主短视频笔记随其所在「订阅专题」一并同步并归类 |
| 增量 & 安全 | 仅同步得到大脑内容；按 `updated_at` 覆盖；只增不删；断点续传 |
| 完整界面 | 设置页 + 命令面板 + 快捷键 + 功能区图标 + 同步日志 |

---

## 安装（开发 / BRAT 测试）

1. 把本仓库克隆到本地，进入目录安装依赖并构建：
   ```bash
   npm install
   npm run build
   ```
   构建产物为仓库根目录的 `main.js`、`manifest.json`、`styles.css`。
2. 将这三个文件复制到你的 vault：`<vault>/.obsidian/plugins/dedao-kb-sync/`。
3. 在 Obsidian 设置 → 第三方插件中，启用「得到大脑知识库同步」。

> 也可用 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 添加 GitHub 仓库地址进行Beta 安装。

---

## 设置说明

1. **凭证设置**：选择 OpenAPI 鉴权（会员）或临时鉴权，填入 Token / Client ID，点「测试连接」。
2. **目标文件夹**：所有笔记的默认根目录（如 `00-Inbox`）。
3. **允许同步知识库**：勾选要同步的知识库（含订阅的抖音博主专题）。展开后可「全选」或搜索。
4. **知识库文件夹映射**（本插件新增）：
   - **知识库根目录**：所有知识库文件夹所在的根目录，位于「目标文件夹」之下。留空则直接落在 `目标文件夹/库名`；默认填 `知识库` 则落在 `目标文件夹/知识库/库名`。
   - **知识库 → 文件夹**：为每个知识库指定文件夹名（默认用库原生名）。界面会实时显示完整落盘路径，例如 `00-Inbox/我的读书`。
5. **定时自动同步**：开启后，按「同步间隔（分钟）」自动从得到大脑增量同步；可勾选「启动时同步」。
6. **附件下载配置**：图片 / 音频 / 视频 / 文档，按需开启。
7. 点「同步笔记」或功能区图标立即同步；或点「按知识库同步」单独同步某几个库。

### 每条知识库笔记的 frontmatter 示例

```yaml
---
uid: "xxxxx"
title: "笔记标题"
created: 2026-04-27 22:26:17
modified: 2026-04-28 09:10:00
source: 得到大脑
note_type: plain_text
tags: ["#知识库/我的读书"]
kb: "我的读书"
---
```

---

## 发布到 Obsidian 社区插件市场

最终由你在 GitHub 上执行（需要 GitHub 账号）：

1. 在 GitHub 新建公开仓库（例如 `obsidian-dedao-kb-sync`），将本仓库代码推上去。
2. 打一个 Release Tag（如 `1.0.0`）。
3. 在 `manifest.json` 中确认 `id` 为 `dedao-kb-sync`。
4. 向官方清单仓库提交 PR：
   - 仓库：<https://github.com/obsidianmd/obsidian-releases>
   - 修改 `community-plugins.json`，追加：
     ```json
     {
       "id": "dedao-kb-sync",
       "name": "得到大脑知识库同步",
      "author": "Marvincao",
      "description": "按知识库自动建文件夹并打标签，把得到大脑与订阅的抖音博主内容同步到 Obsidian。",
      "repo": "https://github.com/leschamy4-del/obsidian-dedao-kb-sync"
     }
     ```
5. PR 合并后，所有 Obsidian 用户即可在「第三方插件」中搜索安装。

---

## 版权与署名

- 原始项目：[obsidian-dedao-brain-sync](https://github.com/AndyZhengyan/obsidian-dedao-brain-sync) © Andy Zheng（MIT）。
- 本衍生插件 © 朱美丹。
- 本插件基于 MIT 协议发布，保留原作者版权署名。

## 免责声明

本插件仅面向得到大脑会员的个人知识管理用途，使用需遵守得到大脑开放平台的服务条款与调用配额限制。插件作者不对因使用本插件导致的任何数据问题负责。
