# Dedao KB Sync

[English](./README_EN.md)

Dedao KB Sync is an Obsidian plugin for Dedao Brain / GetNote members. It syncs selected Dedao Brain knowledge bases, subscribed topics, and subscribed blogger content into local Markdown files, organized by knowledge base and blogger folders.

中文说明：这是一个面向得到大脑（原 Get 笔记）会员的 Obsidian 插件：把选定的得到大脑知识库、订阅专题和订阅博主内容同步为本地 Markdown，并按知识库与博主自动建立文件夹。

> 本插件衍生自 [AndyZhengyan/obsidian-dedao-brain-sync](https://github.com/AndyZhengyan/obsidian-dedao-brain-sync)（MIT 协议）。当前仓库重点补齐“按知识库组织”和“订阅博主归档”能力，并保留原项目的同步、搜索、模板、反向上传等基础能力。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 选择知识库同步 | 在设置中选择要同步的得到大脑知识库；未选择知识库时，后台定时同步会跳过，避免同步不需要的内容。 |
| 按知识库建文件夹 | 同步到本地目标目录后，每个知识库使用独立文件夹，默认文件夹名与得到大脑知识库名称一致。 |
| 5 分钟自动同步 | 自动同步间隔最低为 5 分钟，可设置启动时同步；自动同步按上次断点增量拉取。 |
| 文件命名 | 笔记默认按“创建日期 + 标题/主题总结”命名。 |
| 订阅博主归档 | 订阅博主内容会同步到对应知识库文件夹下，并按博主名称再建一级子文件夹。 |
| 转写进正文 | 录音和短视频内容的语音转写会写入主 Markdown 正文；默认不下载 MP3。 |
| 默认不下载附件 | 图片、音频、视频、文档附件默认关闭，避免继续生成额外 asset 文件夹；已有历史 asset 不会被自动删除。 |
| 去重与增量 | 已存在的笔记按 `uid/note_id` 保守跳过，不重复写入；插件只同步得到大脑内容，不删除本地文件。 |

## 推荐的本地结构

假设目标文件夹设置为 `00-Inbox`，选择了一个名为 `00-订阅知识博主知识库` 的知识库，并订阅了博主 `Next蔡蔡`，同步后结构类似：

```text
00-Inbox/
└── 00-订阅知识博主知识库/
    └── Next蔡蔡/
        └── 2026年08月19日_Codex不同对话怎么无缝衔接.md
```

普通知识库内容则直接进入对应知识库文件夹：

```text
00-Inbox/
└── 03-赚钱管理知识库（自媒体文章&口播）/
    └── 2026年06月26日_安全人年终价值呈现指南.md
```

## 安装（手动 / BRAT 测试）

1. 从 GitHub Release 下载：
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. 复制到你的 vault：

```text
<your-vault>/.obsidian/plugins/dedao-kb-sync/
```

3. 重启 Obsidian，或关闭后重新启用该插件。
4. 在 Obsidian 设置 → 第三方插件中启用 `Dedao KB Sync`。

也可以通过 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 添加本仓库进行测试安装。

## 设置说明

1. 选择鉴权方式：OpenAPI 鉴权（会员）或临时 Web 鉴权。
2. 设置目标文件夹，例如 `00-Inbox`。
3. 在“允许同步知识库”里勾选要同步的得到大脑知识库。
4. 按需调整“知识库文件夹映射”；默认使用得到大脑中的知识库名称。
5. 开启定时自动同步，建议间隔保持 5 分钟或以上。
6. 附件下载默认全部关闭。如确实需要图片、视频或文档，可手动开启对应类型。

## 社区插件提交说明

Obsidian 当前使用 Community Directory 提交插件。提交前需要确保仓库根目录有：

- `README.md`
- `LICENSE`
- `manifest.json`
- 与 `manifest.json` 版本一致的 GitHub Release

Release 的 tag 必须和 `manifest.json` 中的 `version` 一致，例如 `1.0.3`。Release 需要上传：

- `main.js`
- `manifest.json`
- `styles.css`

然后登录 [Obsidian Community Directory](https://community.obsidian.md)，连接 GitHub 账号，提交本仓库地址：

```text
https://github.com/leschamy4-del/obsidian-dedao-kb-sync
```

官方说明：[Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin)。

## 后续规划：得到读书独立插件

“得到读书”的书籍划线、批注和读书感悟不在本插件当前能力范围内。建议单独做一个 `dedao-reading-sync` 插件：按“得到读书/书名/划线与感悟”组织文件，避免和知识库、博主同步逻辑互相污染。

## 版权与署名

- 原始项目：[obsidian-dedao-brain-sync](https://github.com/AndyZhengyan/obsidian-dedao-brain-sync) © Andy Zheng（MIT）。
- 本衍生插件 © Marvincao。
- 本插件基于 MIT 协议发布，保留原作者版权署名。

## 免责声明

本插件仅面向得到大脑会员的个人知识管理用途。使用者需要遵守得到大脑开放平台的服务条款、会员权益和调用配额限制。插件作者不对因使用插件导致的数据丢失、重复同步或第三方服务限制负责。
