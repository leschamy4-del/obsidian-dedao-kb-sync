# Dedao KB Sync

[中文](./README.md)

Dedao KB Sync is an Obsidian plugin for Dedao Brain / GetNote members. It syncs selected Dedao Brain knowledge bases, subscribed topics, and subscribed blogger content into local Markdown files, organized by knowledge base and blogger folders.

> This plugin is derived from [AndyZhengyan/obsidian-dedao-brain-sync](https://github.com/AndyZhengyan/obsidian-dedao-brain-sync) under the MIT license. This fork focuses on knowledge-base folder organization and subscribed blogger filing while preserving the original sync, search, template, and local upload foundations.

## Features

| Feature | Description |
| --- | --- |
| Selected knowledge-base sync | Choose which Dedao Brain knowledge bases to sync. Scheduled sync is skipped when no knowledge base is selected. |
| Folder per knowledge base | Each selected knowledge base is written to its own local folder. The default folder name matches the remote knowledge-base name. |
| Scheduled sync | Runs at a minimum interval of 5 minutes and resumes from the last successful checkpoint. |
| Filename convention | Notes are named with their remote creation date plus the title or topic summary. |
| Blogger subfolders | Subscribed blogger posts are synced under the corresponding knowledge-base folder, then grouped by blogger name. |
| Transcript in main Markdown | Speech-to-text transcripts are rendered into the main Markdown note. MP3 download is disabled by default. |
| No attachment download by default | Images, audio, video, and document attachments are disabled by default to avoid generating extra asset folders. Existing historical asset files are not deleted automatically. |
| Incremental and conservative | Existing local notes are skipped by `uid/note_id`; the plugin syncs Dedao Brain content and does not delete local files. |

## Recommended local layout

If the target folder is `00-Inbox`, a selected knowledge base named `00-订阅知识博主知识库` with a blogger named `Next蔡蔡` is written like this:

```text
00-Inbox/
└── 00-订阅知识博主知识库/
    └── Next蔡蔡/
        └── 2026年08月19日_Codex不同对话怎么无缝衔接.md
```

Regular knowledge-base notes are written directly under the knowledge-base folder:

```text
00-Inbox/
└── 03-赚钱管理知识库（自媒体文章&口播）/
    └── 2026年06月26日_安全人年终价值呈现指南.md
```

## Manual installation

1. Download these files from the latest GitHub Release:
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. Copy them into your vault:

```text
<your-vault>/.obsidian/plugins/dedao-kb-sync/
```

3. Restart Obsidian or disable and re-enable the plugin.
4. Enable `Dedao KB Sync` from Obsidian's third-party plugin settings.

You can also test with [BRAT](https://github.com/TfTHacker/obsidian42-brat) by adding this repository.

## Settings

1. Choose OpenAPI auth for members, or temporary Web auth.
2. Set the target folder, for example `00-Inbox`.
3. Select the Dedao Brain knowledge bases you want to sync.
4. Adjust knowledge-base folder mappings if needed. By default, the remote knowledge-base name is used.
5. Enable scheduled sync. Keep the interval at 5 minutes or higher.
6. Attachment download is disabled by default. Enable image, video, or document import only if you explicitly need those files.

## Community plugin submission

Obsidian now uses the Community Directory submission flow. Before submitting, make sure the repository root contains:

- `README.md`
- `LICENSE`
- `manifest.json`
- a GitHub Release whose tag matches the `version` in `manifest.json`

The release tag must match the manifest version, for example `1.0.3`. Upload these release assets:

- `main.js`
- `manifest.json`
- `styles.css`

Then sign in to [Obsidian Community Directory](https://community.obsidian.md), connect your GitHub account, and submit this repository:

```text
https://github.com/leschamy4-del/obsidian-dedao-kb-sync
```

Official guide: [Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin).

## Future work: separate Dedao Reading plugin

Dedao reading highlights, annotations, and reading reflections are not part of this plugin's current scope. They should be implemented as a separate `dedao-reading-sync` plugin that organizes files by `Dedao Reading / Book Title / Highlights and Reflections`, keeping reading data separate from knowledge-base and blogger sync.

## Credits and license

- Original project: [obsidian-dedao-brain-sync](https://github.com/AndyZhengyan/obsidian-dedao-brain-sync) © Andy Zheng, MIT license.
- This derivative plugin © Marvincao.
- Released under the MIT license with original author attribution preserved.

## Disclaimer

This plugin is for personal knowledge management by Dedao Brain members. Users must comply with Dedao Brain's service terms, membership permissions, and API quota limits. The plugin author is not responsible for data loss, duplicate sync results, or third-party service restrictions.
