# Dedao KB Sync

[中文说明](./README_ZH.md)

Dedao KB Sync is an Obsidian plugin for Dedao Brain / GetNote members. It syncs selected Dedao Brain knowledge bases, subscribed topics, and subscribed blogger content into local Markdown files, organized by knowledge-base and blogger folders.

This plugin is derived from [AndyZhengyan/obsidian-dedao-brain-sync](https://github.com/AndyZhengyan/obsidian-dedao-brain-sync) under the MIT license. This fork focuses on knowledge-base folder organization, subscribed blogger filing, scheduled incremental sync, and conservative attachment handling while preserving the original sync, search, template, and local upload foundations.

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

## Installation

### Install from GitHub Release

1. Download these files from the latest GitHub Release:
   - `main.js`
   - `manifest.json`
   - `styles.css`
2. Copy them into your vault:

```text
<your-vault>/.obsidian/plugins/dedao-kb-sync/
```

3. Restart Obsidian, or disable and re-enable the plugin.
4. Enable `Dedao KB Sync` from Obsidian's third-party plugin settings.

### Install with BRAT

You can also test the plugin with [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install BRAT in Obsidian.
2. Add this repository as a beta plugin:

```text
https://github.com/leschamy4-del/obsidian-dedao-kb-sync
```

3. Enable `Dedao KB Sync` after BRAT installs it.

## Usage

1. Open Obsidian settings and find `Dedao KB Sync`.
2. Choose an authentication method:
   - OpenAPI authentication for Dedao Brain members.
   - Temporary Web authentication when OpenAPI is not available.
3. Set the target folder, for example `00-Inbox`.
4. Select the Dedao Brain knowledge bases you want to sync.
5. Optional: adjust folder mappings if you do not want to use the remote knowledge-base name.
6. Click manual sync, or enable scheduled sync.
7. Keep the scheduled sync interval at 5 minutes or higher.

If no knowledge base is selected, scheduled sync is skipped. This prevents the plugin from syncing content you did not explicitly choose.

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

## Settings

| Setting | Recommended value | Notes |
| --- | --- | --- |
| Target folder | `00-Inbox` or another vault folder | The plugin creates knowledge-base folders under this path. |
| Allowed knowledge bases | Select only the knowledge bases you need | Empty selection means scheduled sync is skipped. |
| Scheduled sync | Enabled after initial testing | The minimum interval is 5 minutes. |
| Attachment import | Disabled by default | Enable image, video, or document import only when you explicitly need those files. |
| Audio import | Disabled by default | MP3 files are not downloaded by default, but transcripts are rendered into Markdown. |

## Privacy and data handling

- The plugin stores synced Dedao Brain content as local Markdown files in your Obsidian vault.
- It does not delete local notes automatically.
- It does not download MP3 files by default.
- It does not generate extra asset folders by default when attachment import is disabled.
- Authentication data is used only to call Dedao Brain / GetNote APIs from the plugin.
- You are responsible for complying with Dedao Brain's terms, membership permissions, and API quota limits.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| No notes are synced | Confirm that at least one knowledge base is selected in plugin settings. |
| Scheduled sync does nothing | Confirm scheduled sync is enabled and the interval is 5 minutes or higher. |
| Notes appear in the wrong folder | Check the target folder and knowledge-base folder mapping. |
| Blogger notes are not grouped | Confirm the content belongs to a subscribed blogger knowledge base and rerun sync. |
| Extra asset files appear | Check whether image, video, audio, or document attachment import was manually enabled. |
| Authentication fails | Re-check OpenAPI credentials or refresh temporary Web authentication. |

## Feedback

Please report bugs and feature requests through GitHub Issues:

```text
https://github.com/leschamy4-del/obsidian-dedao-kb-sync/issues
```

When reporting a sync problem, include the plugin version, Obsidian version, sync mode, and a short description of the folder structure you expected.

## Release requirements for Obsidian

Before each release, the repository must contain:

- `README.md`
- `LICENSE`
- `manifest.json`
- a GitHub Release whose tag matches the `version` in `manifest.json`

For version `1.0.4`, the release tag must be `1.0.4`, and the release assets must include:

- `main.js`
- `manifest.json`
- `styles.css`

Official guide: [Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin).

## Future work: separate Dedao Reading plugin

Dedao reading highlights, annotations, and reading reflections are not part of this plugin's current scope. They should be implemented as a separate `dedao-reading-sync` plugin that organizes files by `Dedao Reading / Book Title / Highlights and Reflections`, keeping reading data separate from knowledge-base and blogger sync.

## License and credits

- Original project: [obsidian-dedao-brain-sync](https://github.com/AndyZhengyan/obsidian-dedao-brain-sync) © Andy Zheng, MIT license.
- This derivative plugin © Marvincao.
- Released under the MIT license with original author attribution preserved.

## Disclaimer

This plugin is for personal knowledge management by Dedao Brain members. Users must comply with Dedao Brain's service terms, membership permissions, and API quota limits. The plugin author is not responsible for data loss, duplicate sync results, or third-party service restrictions.
