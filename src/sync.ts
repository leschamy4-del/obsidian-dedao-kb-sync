import { App, TFile } from 'obsidian';
import { fetchAllNotes, fetchNoteChildren, fetchNoteDetail, fetchNoteOriginal, fetchSubscribedKnowledgeNotes } from './api';
import { formatDateTime, renderNote, renderNoteWithTemplate, generateDisplayTitle } from './note-parser';
import { getCategoryDir } from './types';
import { getAuthCredentials, type GetNoteNote, type Settings, type SubscribedTopic, type SyncResult, type SyncResultItem, type SyncScopeOptions } from './types';
import { applyTagFilter } from './utils/tag-aggregator';
import type { SyncModal } from './ui/sync-modal';
import { t } from './i18n';
import { tryWriteBinary } from './utils/vault-fs';
import { classifyAttachmentUrl, isAttachmentTypeEnabled } from './utils/attachments';
import {
  buildNoteBaseName,
  getAudioAssetBaseName,
  getFileName,
  getFilePath,
  getKnowledgeBaseDir,
} from './sync-paths';

const AUDIO_NOTE_TYPES = new Set([
  'recorder_audio',
  'recorder_flash_audio',
  'immediate_audio',
  'audio_long',
  'local_audio',
  'audio',
  'class_audio',
  'internal_record',
  'meeting',
]);

const IMAGE_NOTE_TYPES = new Set([
  'img_text',
]);

const LINK_NOTE_TYPES = new Set([
  'link',
]);

function parseSyncBoundaryTime(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseNoteUpdatedTime(note: GetNoteNote): number | null {
  const parsed = Date.parse(note.updated_at);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseNoteCreatedTime(note: GetNoteNote): number | null {
  const parsed = Date.parse(note.created_at);
  return Number.isNaN(parsed) ? null : parsed;
}

function isSortedByCreatedDesc(notes: GetNoteNote[]): boolean {
  let previous: number | null = null;
  for (const note of notes) {
    const current = parseNoteCreatedTime(note);
    if (current === null) return false;
    if (previous !== null && current > previous) return false;
    previous = current;
  }
  return true;
}

function isSafeAttachmentUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

const IMAGE_EXT_PATTERN = /\.(png|jpg|jpeg|gif|webp|bmp|svg)(\?|$)/i;

function extractImageExtension(url: string): string {
  const match = url.match(IMAGE_EXT_PATTERN);
  return match ? match[1].toLowerCase() : 'png';
}

function isImageAttachment(attachment: { type: string }): boolean {
  return attachment.type === 'image';
}

function imageAssetFilename(baseFilename: string, ext: string, index: number): string {
  const suffix = index === 0 ? '' : `_${index + 1}`;
  const rawFilename = `${baseFilename}_image${suffix}.${ext}`;
  return rawFilename.split('/').pop()!.split('\\').pop()!;
}

/**
 * Pick the download path for a non-image attachment based on its URL extension.
 * Image attachments keep the legacy `<base>_image<N>.<ext>` naming used by
 * `imageAssetFilename()` so existing vault files don't get renamed.
 */
function genericAssetFilename(baseFilename: string, url: string, index: number, kind: string): string {
  const cleanUrl = url.split(/[?#]/)[0];
  const lastSlash = cleanUrl.lastIndexOf('/');
  const filename = lastSlash >= 0 ? cleanUrl.slice(lastSlash + 1) : cleanUrl;
  const dot = filename.lastIndexOf('.');
  const ext = dot > 0 && dot < filename.length - 1 ? filename.slice(dot + 1).toLowerCase() : 'bin';
  const safeName = filename.split('/').pop()!.split('\\').pop()!.replace(/[^A-Za-z0-9._-]/g, '_');
  // If the API's filename is empty, synthesize one
  const sourceName = safeName && safeName !== '.' ? safeName : `${kind}.${ext}`;
  const suffix = index === 0 ? '' : `_${index + 1}`;
  const sourceDot = sourceName.lastIndexOf('.');
  if (sourceDot > 0) {
    return `${baseFilename}_${sourceName.slice(0, sourceDot)}${suffix}${sourceName.slice(sourceDot)}`;
  }
  return `${baseFilename}_${sourceName}${suffix}`;
}

function isDownloadableAttachment(
  attachment: { type: string; url: string },
  settings: Settings
): boolean {
  const kind = classifyAttachmentUrl(attachment.url);
  if (kind === 'other') return true; // never silently drop unrecognized
  return isAttachmentTypeEnabled(settings.attachmentImport, kind);
}

function hasImageAssetPaths(note: GetNoteNote): boolean {
  return (note.assetPaths ?? []).some(path => /\.(png|jpg|jpeg|gif|webp|bmp|svg)(\?|$)/i.test(path));
}

export class SyncCancelledError extends Error {
  constructor() {
    super('Sync cancelled');
    this.name = 'SyncCancelledError';
  }
}

export interface SyncProgressCallback {
  (info: { page?: number; processed?: number; total?: number; created?: number; updated?: number; skipped?: number; failed?: number; percent?: number }): void;
}

export interface SubscribedKnowledgeSyncOptions {
  selectedNoteIds?: string[];
  syncAll?: boolean;
  topicIds?: string[];
  createdTopicIds?: string[];
  bloggerIds?: string[];
  knowledgeBaseName?: string;
  knowledgeBaseNames?: Record<string, string>;
  syncTags?: string[];
}

type WriteStatus = SyncResultItem['status'];

interface WriteNoteResult {
  status: WriteStatus;
  file?: TFile;
  error?: string;
}

export class SyncEngine {
  private app: App;
  private settings: Settings;
  private scopeOptions: SyncScopeOptions;
  private onProgress?: SyncProgressCallback;
  private onCancel?: () => void;
  private cancelled = false;
  private abortController: AbortController | null = null;
  private forceResync: boolean;

  constructor(app: App, settings: Settings, onProgress?: SyncProgressCallback, scopeOptions?: Partial<SyncScopeOptions>) {
    this.app = app;
    this.settings = settings;
    const syncStartDate = scopeOptions?.syncStartDate ?? settings.syncStartDate;
    const enabledNoteTypes = scopeOptions?.enabledNoteTypes;
    const syncTags = scopeOptions?.syncTags;
    const syncKnowledgeBases = scopeOptions?.syncKnowledgeBases;
    this.scopeOptions = {
      maxDays: syncStartDate ? 0 : scopeOptions?.maxDays ?? settings.maxDays,
      syncStartDate,
      ...(enabledNoteTypes !== undefined ? { enabledNoteTypes } : {}),
      ...(syncTags !== undefined && syncTags.length > 0 ? { syncTags } : {}),
      ...(syncKnowledgeBases !== undefined ? { syncKnowledgeBases } : {}),
      ...(scopeOptions?.knowledgeBaseNames ? { knowledgeBaseNames: scopeOptions.knowledgeBaseNames } : {}),
      ...(scopeOptions?.knowledgeBaseEntries ? { knowledgeBaseEntries: scopeOptions.knowledgeBaseEntries } : {}),
    };
    // forceResync 只作为引擎内部开关使用，不写入 scopeOptions（避免破坏基于 scopeOptions 的精确断言/序列化）
    this.forceResync = scopeOptions?.forceResync ?? settings.forceResync ?? false;
    this.onProgress = onProgress;
  }

  private async ensureCategoryDir(categoryDir: string): Promise<string> {
    const basePath = this.settings.folderName;
    const fullPath = `${basePath}/${categoryDir}`;
    const targetDir = this.app.vault.getAbstractFileByPath(fullPath);
    if (!targetDir) {
      await this.app.vault.createFolder(fullPath);
    }
    return fullPath;
  }

  private getKnowledgeBaseDir(name: string): string {
    return getKnowledgeBaseDir(name);
  }

  /**
   * 从本地知识库缓存构建 topicId → 名称 映射（供手动"按知识库同步"路径使用，
   * 该路径的 scopeOptions 未携带 knowledgeBaseNames）。
   */
  private kbNamesFromCache(): Record<string, string> {
    const entries = this.settings.knowledgeBaseCache?.entries ?? [];
    const map: Record<string, string> = {};
    for (const entry of entries) {
      if (entry?.topicId) map[entry.topicId] = entry.name;
    }
    return map;
  }

  /**
   * 解析单个知识库的目标文件夹（相对于"目标文件夹"）。
   * - 设置了 kbFolderMap[topicId] 则用自定义文件夹名；
   * - 否则默认用库原生名（与 getKnowledgeBaseDir 行为一致）；
   * - 最终路径 = kbFolderRoot（默认"知识库"）/ 文件夹名。
   */
  private resolveKbFolder(topicId: string, name: string): string {
    const custom = this.settings.kbFolderMap?.[topicId];
    const seg = (custom && custom.trim())
      ? custom.trim().replace(/[\\/:*?"<>|]/g, '_')
      : name.replace(/[\\/:*?"<>|]/g, '_').trim() || t('picker.noTitle');
    const root = (this.settings.kbFolderRoot ?? '').trim();
    return root ? `${root}/${seg}` : seg;
  }

  /**
   * 根据笔记的 topic_id 解析知识库目标文件夹与名称。
   * 命中则返回 { folder, name }，否则返回空（笔记走默认类型文件夹）。
   */
  private resolveKb(note: GetNoteNote): { folder?: string; name?: string } {
    const topicId = note.topic_id;
    if (!topicId) return {};
    const names = this.scopeOptions.knowledgeBaseNames ?? this.kbNamesFromCache();
    const name = names[topicId];
    if (!name) return {};
    return { folder: this.resolveKbFolder(topicId, name), name };
  }

  private resolveKbForSubscribedSync(note: GetNoteNote, options: SubscribedKnowledgeSyncOptions): { folder?: string; name?: string } {
    const resolved = this.resolveKb(note);
    if (resolved.name) return resolved;

    const topicId = note.topic_id;
    const name = (topicId ? options.knowledgeBaseNames?.[topicId] : undefined)
      ?? options.knowledgeBaseNames?.[note.note_id]
      ?? options.knowledgeBaseName;
    if (!name) return {};
    return {
      folder: topicId ? this.resolveKbFolder(topicId, name) : this.getKnowledgeBaseDir(name),
      name,
    };
  }

  /**
   * 博主帖按博主名落子文件夹：在知识库根目录（categoryOverride）下追加 <博主名> 段。
   * 例如 00-订阅知识博主知识库/朴素之道/。非博主帖、缺失博主名或缺失根目录时原样返回。
   * 文件名非法字符统一替换为下划线，与 resolveKbFolder 保持一致。
   */
  private resolveBloggerSubfolder(note: GetNoteNote, baseFolder: string | undefined): string | undefined {
    if (note.note_type !== 'blogger_post' || !baseFolder) return baseFolder;
    const name = note.bloggerName?.trim();
    if (!name) return baseFolder;
    const seg = name.replace(/[\\/:*?"<>|]/g, '_').trim();
    return seg ? `${baseFolder}/${seg}` : baseFolder;
  }

  private buildBaseName(note: GetNoteNote): string {
    return buildNoteBaseName(note, this.settings);
  }

  private getFileName(note: GetNoteNote, parentBaseName?: string): string {
    return getFileName(note, this.settings, parentBaseName);
  }

  private getAudioAssetBaseName(note: GetNoteNote): string {
    return getAudioAssetBaseName(note, this.settings);
  }

  private getFilePath(categoryDir: string, note: GetNoteNote): string {
    return getFilePath(categoryDir, note, this.settings);
  }

  private resolveConflict(categoryDir: string, baseName: string): string {
    let suffix = 2;
    let path: string;
    do {
      path = `${categoryDir}/${baseName}-${suffix}.md`;
      suffix++;
    } while (this.app.vault.getAbstractFileByPath(path));
    return path;
  }

  cancel(): void {
    this.cancelled = true;
    this.abortController?.abort();
  }

  setOnCancel(fn: () => void): void {
    this.onCancel = fn;
  }

  private async downloadAudioAsset(
    note: GetNoteNote,
    attachment: { type: string; url: string; title: string; duration?: number },
    categoryOverride?: string
  ): Promise<string | null> {
    try {
      if (!isSafeAttachmentUrl(attachment.url)) {
        console.warn('[DedaoBrain] Skipped unsafe audio attachment URL');
        return null;
      }

      const categoryDir = await this.ensureCategoryDir(categoryOverride ?? getCategoryDir(note.note_type));
      const assetDir = `${categoryDir}/asset`;
      if (!this.app.vault.getAbstractFileByPath(assetDir)) {
        await this.app.vault.createFolder(assetDir);
      }

      const rawFilename = `${this.getAudioAssetBaseName(note)}_audio.mp3`;
      const filename = rawFilename.split('/').pop()!.split('\\').pop()!;
      const targetPath = `${assetDir}/${filename}`;

      // Skip already-existing files
      if (this.app.vault.getAbstractFileByPath(targetPath)) return targetPath;

      const res = await fetch(attachment.url);
      if (res.status < 200 || res.status >= 300) {
        console.error(`[DedaoBrain] Audio download failed: ${res.status}`);
        return null;
      }
      const arrayBuffer = await res.arrayBuffer();
      await tryWriteBinary(this.app, targetPath, arrayBuffer);
      return targetPath;
    } catch (err) {
      console.error(`[DedaoBrain] Audio download error:`, err);
      return null;
    }
  }

  private async downloadImageAsset(
    note: GetNoteNote,
    attachment: { type: string; url: string; title: string },
    index = 0,
    categoryOverride?: string
  ): Promise<string | null> {
    try {
      if (!isSafeAttachmentUrl(attachment.url)) {
        console.warn('[DedaoBrain] Skipped unsafe image attachment URL');
        return null;
      }

      const categoryDir = await this.ensureCategoryDir(categoryOverride ?? getCategoryDir(note.note_type));
      const assetDir = `${categoryDir}/asset`;
      if (!this.app.vault.getAbstractFileByPath(assetDir)) {
        await this.app.vault.createFolder(assetDir);
      }

      const ext = extractImageExtension(attachment.url);
      const filename = imageAssetFilename(this.getFileName(note), ext, index);
      const targetPath = `${assetDir}/${filename}`;

      if (this.app.vault.getAbstractFileByPath(targetPath)) return targetPath;

      const res = await fetch(attachment.url);
      if (res.status < 200 || res.status >= 300) {
        console.error(`[DedaoBrain] Image download failed: ${res.status}`);
        return null;
      }
      const arrayBuffer = await res.arrayBuffer();
      await tryWriteBinary(this.app, targetPath, arrayBuffer);
      return targetPath;
    } catch (err) {
      console.error(`[DedaoBrain] Image download error:`, err);
      return null;
    }
  }

  private async downloadGenericAsset(
    note: GetNoteNote,
    attachment: { type: string; url: string; title: string },
    index: number,
    categoryOverride?: string
  ): Promise<string | null> {
    try {
      if (!isSafeAttachmentUrl(attachment.url)) {
        console.warn('[DedaoBrain] Skipped unsafe generic attachment URL');
        return null;
      }

      const kind = classifyAttachmentUrl(attachment.url);
      const categoryDir = await this.ensureCategoryDir(categoryOverride ?? getCategoryDir(note.note_type));
      const assetDir = `${categoryDir}/asset`;
      if (!this.app.vault.getAbstractFileByPath(assetDir)) {
        await this.app.vault.createFolder(assetDir);
      }

      const filename = genericAssetFilename(this.getFileName(note), attachment.url, index, kind);
      const targetPath = `${assetDir}/${filename}`;

      if (this.app.vault.getAbstractFileByPath(targetPath)) return targetPath;

      const res = await fetch(attachment.url);
      if (res.status < 200 || res.status >= 300) {
        console.error(`[DedaoBrain] Generic asset download failed (${kind}): ${res.status}`);
        return null;
      }
      const arrayBuffer = await res.arrayBuffer();
      await tryWriteBinary(this.app, targetPath, arrayBuffer);
      return targetPath;
    } catch (err) {
      console.error(`[DedaoBrain] Generic asset download error:`, err);
      return null;
    }
  }

  private async writeAudioTranscriptAsset(note: GetNoteNote, categoryOverride?: string): Promise<string | null> {
    if (!note.audio) return null;

    try {
      const categoryDir = await this.ensureCategoryDir(categoryOverride ?? getCategoryDir(note.note_type));
      const assetDir = `${categoryDir}/asset`;
      if (!this.app.vault.getAbstractFileByPath(assetDir)) {
        await this.app.vault.createFolder(assetDir);
      }

      const targetPath = `${assetDir}/${this.getAudioAssetBaseName(note)}_transcript.md`;
      const content = `# ${generateDisplayTitle(note) || t('picker.noTitle')}\n\n${note.audio}`;
      const existing = this.app.vault.getAbstractFileByPath(targetPath);
      if (existing instanceof TFile) {
        await this.app.vault.modify(existing, content);
      } else {
        await this.app.vault.create(targetPath, content);
      }
      return targetPath;
    } catch (err) {
      console.error('[DedaoBrain] Audio transcript write error:', err);
      return null;
    }
  }

  private async writeLinkOriginalAsset(note: GetNoteNote, categoryOverride?: string): Promise<string | null> {
    const originalContent = note.linkOriginal?.content.trim();
    if (!originalContent) return null;

    try {
      const categoryDir = await this.ensureCategoryDir(categoryOverride ?? getCategoryDir(note.note_type));
      const assetDir = `${categoryDir}/asset`;
      if (!this.app.vault.getAbstractFileByPath(assetDir)) {
        await this.app.vault.createFolder(assetDir);
      }

      const targetPath = `${assetDir}/${this.getAudioAssetBaseName(note)}_original.md`;
      const title = note.linkOriginal?.title?.trim() || generateDisplayTitle(note) || t('picker.noTitle');
      const url = note.linkOriginal?.url?.trim();
      const sourceLine = url ? `来源链接：${url}\n\n` : '';
      const content = `# ${title}\n\n${sourceLine}${originalContent}`;
      const existing = this.app.vault.getAbstractFileByPath(targetPath);
      if (existing) {
        await this.app.vault.modify(existing as TFile, content);
      } else {
        await this.app.vault.create(targetPath, content);
      }
      return targetPath;
    } catch (err) {
      console.error('[DedaoBrain] Link original write error:', err);
      return null;
    }
  }

  /**
   * Check if a note and all its artifacts already exist in the vault and are up to date.
   * Uses UID-based lookup so renamed/moved files are still found.
   *
   * `categoryOverride` lets callers route the check at a custom vault path
   * (e.g. `知识库/<name>/`) instead of the default `getCategoryDir(note_type)`
   * location. This is required for cross-KB sync where notes live under a
   * per-knowledge-base directory.
   */
  private preCheckNote(
    note: GetNoteNote,
    uidIndex: Map<string, TFile>,
    _categoryOverride?: string
  ): { exists: boolean; file?: TFile } {
    const existingFile = uidIndex.get(note.note_id);
    if (!existingFile) return { exists: false };

    return { exists: true, file: existingFile };
  }

  private frontmatterHasKnowledgeBaseTag(tags: unknown, kbName: string): boolean {
    const expected = `#知识库/${kbName}`;
    if (!Array.isArray(tags)) return false;
    return tags.some(tag => typeof tag === 'string' && tag === expected);
  }

  private async needsKnowledgeBaseBackfill(file: TFile, note: GetNoteNote, kbName?: string): Promise<boolean> {
    const cached = this.app.metadataCache.getFileCache(file);
    const frontmatter = cached?.frontmatter ?? {};

    if (kbName) {
      const currentKb = frontmatter['kb'];
      const currentTags = frontmatter['tags'];
      if (currentKb !== kbName || !this.frontmatterHasKnowledgeBaseTag(currentTags, kbName)) {
        return true;
      }
    }

    if (this.forceResync && AUDIO_NOTE_TYPES.has(note.note_type)) {
      const content = await this.app.vault.read(file);
      return !content.includes('### 原始录音转写');
    }

    return false;
  }

  private isContentChanged(file: TFile, note: GetNoteNote): boolean {
    try {
      const cached = this.app.metadataCache.getFileCache(file);
      if (!cached?.frontmatter) return true;
      const modified = cached.frontmatter['modified'] as string | undefined;
      if (!modified) return true;
      const noteModified = formatDateTime(note.updated_at);
      return modified !== noteModified;
    } catch {
      return true;
    }
  }

  private buildUidIndex(): Map<string, TFile> {
    const index = new Map<string, TFile>();
    const prefix = this.settings.folderName + '/';
    const allFiles = this.app.vault.getMarkdownFiles();
    for (const file of allFiles) {
      if (!file.path.startsWith(prefix)) continue;
      const cached = this.app.metadataCache.getFileCache(file);
      const uid = cached?.frontmatter?.['uid'] as string | undefined;
      if (uid) {
        index.set(uid, file);
      }
    }
    return index;
  }

  private async readTemplateFile(): Promise<string | null> {
    const templatePath = this.settings.templateFilePath?.trim();
    if (!templatePath) return null;

    const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
    if (!templateFile || typeof templateFile !== 'object' || !('path' in templateFile)) {
      console.warn(`[DedaoBrain] Template file not found: ${templatePath}`);
      return null;
    }

    try {
      return await this.app.vault.read(templateFile as TFile);
    } catch (err) {
      console.warn(`[DedaoBrain] Failed to read template file ${templatePath}:`, err);
      return null;
    }
  }

  private async renderNewNote(
    note: GetNoteNote,
    parentFileName?: string,
    childFileNames?: string[]
  ): Promise<string> {
    const template = await this.readTemplateFile();
    if (!template) {
      return renderNote(note, note.assetFileName, parentFileName, childFileNames);
    }
    return renderNoteWithTemplate(note, template, note.assetFileName, parentFileName, childFileNames);
  }

  private async writeNote(
    note: GetNoteNote,
    uidIndex: Map<string, TFile>,
    parentBaseName?: string,
    parentFileName?: string,
    childFileNames?: string[],
    categoryOverride?: string,
    allowExistingBackfill = false
  ): Promise<WriteNoteResult> {
    try {
      const categoryDir = await this.ensureCategoryDir(categoryOverride ?? getCategoryDir(note.note_type));
      let targetPath = `${categoryDir}/${this.getFileName(note, parentBaseName)}.md`;
      const existingByUid = uidIndex.get(note.note_id);
      const existingAtTarget = this.app.vault.getAbstractFileByPath(targetPath);

      if (existingAtTarget instanceof TFile) {
        if (!existingByUid || existingAtTarget.path !== existingByUid.path) {
          const cached = this.app.metadataCache.getFileCache(existingAtTarget);
          const targetUid = cached?.frontmatter?.['uid'] as string | undefined;
          if (targetUid && targetUid !== note.note_id) {
            const baseName = this.getFileName(note);
            targetPath = this.resolveConflict(categoryDir, baseName);
          }
        }
      }

      if (existingByUid) {
        if (!this.forceResync && !allowExistingBackfill) {
          return { status: 'skipped', file: existingByUid };
        }
        let fileToWrite = existingByUid;
        let renamed = false;
        if (existingByUid.path !== targetPath) {
          const occupiedTarget = this.app.vault.getAbstractFileByPath(targetPath);
          if (occupiedTarget instanceof TFile && occupiedTarget.path !== existingByUid.path) {
            const baseName = this.getFileName(note, parentBaseName);
            targetPath = this.resolveConflict(categoryDir, baseName);
          }
          await this.app.vault.rename(existingByUid, targetPath);
          renamed = true;
          fileToWrite = (this.app.vault.getAbstractFileByPath(targetPath) as TFile | null) ?? existingByUid;
        }
        // 强制重同步：覆盖更新已有文件，补全之前缺失的原文/转写/附件
        const content = renderNote(note, note.assetFileName, parentFileName, childFileNames);
        const contentChanged = allowExistingBackfill || renamed || this.isContentChanged(fileToWrite, note) || hasImageAssetPaths(note) || Boolean(note.linkOriginalFileName);
        await this.app.vault.modify(fileToWrite, content);
        uidIndex.set(note.note_id, fileToWrite);
        return { status: contentChanged ? 'updated' : 'skipped', file: fileToWrite };
      } else if (existingAtTarget instanceof TFile) {
        const content = renderNote(note, note.assetFileName, parentFileName, childFileNames);
        // File exists at target path but wasn't in uidIndex - check content
        const contentChanged = this.isContentChanged(existingAtTarget, note) || hasImageAssetPaths(note) || Boolean(note.linkOriginalFileName);
        await this.app.vault.modify(existingAtTarget, content);
        uidIndex.set(note.note_id, existingAtTarget);
        return { status: contentChanged ? 'updated' : 'skipped', file: existingAtTarget };
      } else {
        const content = await this.renderNewNote(note, parentFileName, childFileNames);
        try {
          await this.app.vault.create(targetPath, content);
          const created = this.app.vault.getAbstractFileByPath(targetPath);
          if (created && created instanceof TFile) {
            uidIndex.set(note.note_id, created);
          }
          return { status: 'created', file: created instanceof TFile ? created : undefined };
        } catch (createErr) {
          // File was created by another process between check and create
          const existing = this.app.vault.getAbstractFileByPath(targetPath);
          if (existing instanceof TFile) {
            const contentChanged = this.isContentChanged(existing, note);
            await this.app.vault.modify(existing, content);
            uidIndex.set(note.note_id, existing);
            return { status: contentChanged ? 'updated' : 'skipped', file: existing };
          }
          throw createErr;
        }
      }
    } catch (err) {
      console.error(`[DedaoBrain] Write failed [${generateDisplayTitle(note) || note.note_id}]:`, err);
      return {
        status: 'failed',
        file: undefined,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private recordItem(result: SyncResult, note: GetNoteNote, writeResult: WriteNoteResult): void {
    result.items?.push({
      noteId: note.note_id,
      title: generateDisplayTitle(note) || t('picker.noTitle'),
      noteType: note.note_type,
      updatedAt: note.updated_at,
      status: writeResult.status,
      error: writeResult.error,
    });
  }

  private applyWriteResult(result: SyncResult, writeResult: WriteNoteResult): void {
    switch (writeResult.status) {
      case 'created': result.created++; break;
      case 'updated': result.updated++; break;
      case 'skipped': result.skipped++; break;
      case 'failed': result.failed++; break;
    }
  }

  /**
   * 记录单个知识库拉取失败（如 403 无权限 / 429 限流 / 网络错误）。
   * 这样用户能在同步历史的 failed 项里直接看到"哪些库没有同步权"。
   */
  private recordTopicFailure(result: SyncResult, topic: SubscribedTopic, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    result.failed++;
    result.total++;
    result.items?.push({
      noteId: `kb:${topic.topic_id}`,
      title: topic.name ?? topic.topic_id,
      noteType: 'knowledge_base',
      updatedAt: '',
      status: 'failed',
      error: message,
    });
  }

  private mergeNoteDetail(note: GetNoteNote, detail: Partial<GetNoteNote>): GetNoteNote {
    const childrenIds = detail.children_ids
      ? detail.children_ids
      : note.children_ids;
    const isChildNote = Object.prototype.hasOwnProperty.call(detail, 'is_child_note')
      ? detail.is_child_note
      : note.is_child_note;
    return {
      ...note,
      ...detail,
      id: detail.id ?? note.id,
      note_id: detail.note_id ?? note.note_id,
      title: detail.title ?? note.title,
      content: detail.content ?? note.content,
      note_type: detail.note_type ?? note.note_type,
      source: detail.source ?? note.source,
      tags: detail.tags ?? note.tags,
      created_at: detail.created_at ?? note.created_at,
      updated_at: detail.updated_at ?? note.updated_at,
      parent_id: detail.parent_id ?? note.parent_id,
      children_count: detail.children_count ?? note.children_count,
      // Don't overwrite relation fields that were already populated by list data;
      // some detail responses omit them.
      children_ids: childrenIds,
      is_child_note: isChildNote,
    };
  }

  private needsRelationDetail(note: GetNoteNote): boolean {
    const childrenCount = note.children_count ?? 0;
    const childrenIdsCount = note.children_ids?.length ?? 0;
    return childrenCount > 0 && childrenCount !== childrenIdsCount;
  }

  private needsImageDetail(note: GetNoteNote): boolean {
    return IMAGE_NOTE_TYPES.has(note.note_type) && !(note.attachments ?? []).some(isImageAttachment);
  }

  private needsLinkOriginalDetail(note: GetNoteNote): boolean {
    return LINK_NOTE_TYPES.has(note.note_type) && !note.linkOriginal;
  }

  private async enrichAudioNote(
    note: GetNoteNote,
    signal: AbortSignal,
    categoryOverride?: string
  ): Promise<GetNoteNote> {
    const needsAudioDetail = AUDIO_NOTE_TYPES.has(note.note_type);
    const needsRelationDetail = this.needsRelationDetail(note);
    const hasImageAttachments = (note.attachments ?? []).some(isImageAttachment);
    const hasDownloadableAttachments = (note.attachments ?? []).some(a => isDownloadableAttachment(a, this.settings));
    const needsImageDetail = this.needsImageDetail(note);
    const needsLinkOriginalDetail = this.needsLinkOriginalDetail(note);
    if (!needsAudioDetail && !needsRelationDetail && !hasDownloadableAttachments && !needsImageDetail && !needsLinkOriginalDetail) {
      return note;
    }
    const credentials = getAuthCredentials(this.settings);
    if (
      credentials.authMode === 'web' &&
      !needsAudioDetail &&
      !hasImageAttachments &&
      !hasDownloadableAttachments &&
      !needsImageDetail &&
      !needsLinkOriginalDetail
    ) {
      return note;
    }

    try {
      let enrichedNote = note;
      if (needsAudioDetail || needsRelationDetail || needsImageDetail || (needsLinkOriginalDetail && credentials.authMode !== 'web')) {
        const detailId = (note as { prime_id?: string }).prime_id ?? note.note_id;
        const noteDetail = await fetchNoteDetail(
          detailId,
          credentials.token,
          credentials.clientId,
          signal,
          credentials.authMode
        );
        enrichedNote = this.mergeNoteDetail(note, noteDetail);
      }
      if (needsLinkOriginalDetail && credentials.authMode === 'web') {
        const detailId = (note as { prime_id?: string }).prime_id ?? note.note_id;
        const linkOriginal = await fetchNoteOriginal(
          detailId,
          credentials.token,
          signal,
          credentials.authMode
        );
        if (linkOriginal) {
          enrichedNote = { ...enrichedNote, linkOriginal };
        }
      }
      if (needsAudioDetail && !isAttachmentTypeEnabled(this.settings.attachmentImport, 'audio')) {
        enrichedNote = {
          ...enrichedNote,
          audio: undefined,
          attachments: enrichedNote.attachments?.filter(attachment => attachment.type !== 'audio'),
        };
      }
      const assetPaths: string[] = [];

      if (needsAudioDetail && isAttachmentTypeEnabled(this.settings.attachmentImport, 'audio')) {
        const audioAttachment = enrichedNote.attachments?.find(a => a.type === 'audio');
        if (audioAttachment) {
          const audioPath = await this.downloadAudioAsset(enrichedNote, audioAttachment, categoryOverride);
          if (audioPath) assetPaths.push(audioPath);
        } else {
          console.warn(`[DedaoBrain] No audio attachment found in note detail [${note.note_id}]`);
        }
        const transcriptPath = await this.writeAudioTranscriptAsset(enrichedNote, categoryOverride);
        if (transcriptPath) assetPaths.push(transcriptPath);
        enrichedNote.assetFileName = this.getAudioAssetBaseName(enrichedNote);
      }

      // Image attachments keep their dedicated downloader (legacy naming scheme).
      // Video / document / unknown attachments go through a generic downloader
      // gated by the per-type settings.
      const imageAttachments = isAttachmentTypeEnabled(this.settings.attachmentImport, 'image')
        ? (enrichedNote.attachments ?? []).filter(isImageAttachment)
        : [];
      for (const [index, img] of imageAttachments.entries()) {
        const imgPath = await this.downloadImageAsset(enrichedNote, img, index, categoryOverride);
        if (imgPath) assetPaths.push(imgPath);
      }

      const genericAttachments = (enrichedNote.attachments ?? []).filter(
        a => !isImageAttachment(a) && a.type !== 'audio' && isDownloadableAttachment(a, this.settings)
      );
      for (const [index, att] of genericAttachments.entries()) {
        const path = await this.downloadGenericAsset(enrichedNote, att, index, categoryOverride);
        if (path) assetPaths.push(path);
      }

      if (enrichedNote.linkOriginal?.content.trim()) {
        const originalPath = await this.writeLinkOriginalAsset(enrichedNote, categoryOverride);
        if (originalPath) {
          enrichedNote.linkOriginalFileName = `${this.getAudioAssetBaseName(enrichedNote)}_original`;
        }
      }

      if (assetPaths.length > 0) {
        enrichedNote.assetPaths = assetPaths;
      }

      return enrichedNote;
    } catch (err) {
      console.warn(`[DedaoBrain] Failed to enrich note ${note.note_id}:`, err);
      return note;
    }
  }

  private async fetchAppendNotes(
    parent: GetNoteNote,
    signal: AbortSignal,
    result: SyncResult,
    categoryOverride?: string
  ): Promise<GetNoteNote[]> {
    const credentials = getAuthCredentials(this.settings);
    if (credentials.authMode === 'web' && (parent.children_count ?? 0) > 0) {
      const parentDetailId = (parent as { prime_id?: string }).prime_id ?? parent.note_id;
      try {
        const children = await fetchNoteChildren(
          parentDetailId,
          credentials.token,
          signal,
          credentials.authMode
        );
        const appendNotes: GetNoteNote[] = [];
        for (const child of children) {
          const baseChild: GetNoteNote = {
            ...child,
            parent_id: child.parent_id || parent.note_id,
            is_child_note: child.is_child_note ?? true,
          };
          appendNotes.push(await this.enrichAudioNote(baseChild, signal, categoryOverride));
        }
        return appendNotes;
      } catch (err) {
        result.failed++;
        const failedNote: GetNoteNote = {
          id: parentDetailId,
          note_id: parentDetailId,
          title: '',
          content: '',
          note_type: 'plain_text',
          source: parent.source,
          tags: [],
          created_at: parent.created_at,
          updated_at: parent.updated_at,
          parent_id: parent.note_id,
          is_child_note: true,
        };
        this.recordItem(result, failedNote, {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
        console.warn(`[DedaoBrain] Failed to fetch append notes for ${parentDetailId}:`, err);
      }
      return [];
    }

    const childIds = parent.children_ids ?? [];
    if (!childIds.length) return [];

    const appendNotes: GetNoteNote[] = [];
    for (const childId of childIds) {
      try {
        const childDetail = await fetchNoteDetail(
          childId,
          credentials.token,
          credentials.clientId,
          signal,
          credentials.authMode
        );
        const baseChild: GetNoteNote = {
          id: childDetail.id ?? childId,
          note_id: childDetail.note_id ?? childId,
          title: childDetail.title ?? '',
          content: childDetail.content ?? '',
          note_type: childDetail.note_type ?? 'plain_text',
          source: childDetail.source ?? parent.source,
          tags: childDetail.tags ?? [],
          created_at: childDetail.created_at ?? parent.created_at,
          updated_at: childDetail.updated_at ?? parent.updated_at,
          parent_id: childDetail.parent_id ?? parent.note_id,
          children_count: childDetail.children_count,
          children_ids: childDetail.children_ids,
          is_child_note: childDetail.is_child_note ?? true,
        };
        const child = await this.enrichAudioNote(
          this.mergeNoteDetail(baseChild, childDetail),
          signal,
          categoryOverride
        );
        appendNotes.push(child);
      } catch (err) {
        result.failed++;
        const failedNote: GetNoteNote = {
          id: childId,
          note_id: childId,
          title: '',
          content: '',
          note_type: 'plain_text',
          source: parent.source,
          tags: [],
          created_at: parent.created_at,
          updated_at: parent.updated_at,
          parent_id: parent.note_id,
          is_child_note: true,
        };
        this.recordItem(result, failedNote, {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
        console.warn(`[DedaoBrain] Failed to fetch append note ${childId}:`, err);
      }
    }
    return appendNotes;
  }

  private filterNotesByDateRange(notes: GetNoteNote[]): GetNoteNote[] {
    const { syncStartDate } = this.scopeOptions;
    if (!syncStartDate) return notes;

    const startTime = parseSyncBoundaryTime(syncStartDate);
    if (startTime === null) return notes;

    return notes.filter(note => {
      const updated = parseNoteUpdatedTime(note);
      return updated !== null && updated > startTime;
    });
  }

  private buildPreviouslySyncedNoteIdSet(): Set<string> {
    const noteIds = new Set<string>();
    for (const entry of this.settings.syncHistory ?? []) {
      if (entry.status !== 'success') continue;
      for (const item of entry.result.items ?? []) {
        if (item.status !== 'failed') {
          noteIds.add(item.noteId);
        }
      }
    }
    return noteIds;
  }

  private filterNotesByDateRangeOrMissingLocal(
    notes: GetNoteNote[],
    uidIndex: Map<string, TFile>,
    previouslySyncedNoteIds: Set<string>
  ): GetNoteNote[] {
    const { syncStartDate } = this.scopeOptions;
    if (!syncStartDate) return notes;

    const startTime = parseSyncBoundaryTime(syncStartDate);
    if (startTime === null) return notes;

    return notes.filter(note => {
      const updated = parseNoteUpdatedTime(note);
      if (updated !== null && updated > startTime) return true;
      return updated === startTime && previouslySyncedNoteIds.has(note.note_id) && !uidIndex.has(note.note_id);
    });
  }

  private filterNotesByType(notes: GetNoteNote[]): GetNoteNote[] {
    const enabledNoteTypes = this.scopeOptions.enabledNoteTypes;
    if (enabledNoteTypes === undefined) return notes;
    if (enabledNoteTypes.length === 0) return [];
    return notes.filter(note => enabledNoteTypes.includes(note.note_type));
  }

  private filterNotesByTags(notes: GetNoteNote[], whitelist?: string[]): GetNoteNote[] {
    return applyTagFilter(notes, whitelist ?? this.scopeOptions.syncTags);
  }

  private filterRecentNotes(notes: GetNoteNote[]): GetNoteNote[] {
    const { maxDays } = this.scopeOptions;
    if (!maxDays || maxDays <= 0) return notes;

    const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
    return notes.filter(note => {
      const updated = parseNoteUpdatedTime(note);
      return updated !== null && updated >= cutoff;
    });
  }

  async sync(modal?: SyncModal): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0, skipped: 0, failed: 0, total: 0, items: [] };
    const uidIndex = this.buildUidIndex();
    const previouslySyncedNoteIds = this.buildPreviouslySyncedNoteIdSet();
    const seenNoteIds = new Set<string>();
    const observedTagNames = new Set<string>();
    const controller = new AbortController();
    this.abortController = controller;
    let pageCount = 0;

    // cutoffTime: earliest time boundary for early exit. Use the newest (most restrictive) of:
    // - syncStartDate (absolute): manual sync user-specified date
    // - maxDays cutoff (relative): only keep notes within last N days
    // Taking the max means early exit fires when EITHER boundary is reached.
    const syncStartCutoff = this.scopeOptions.syncStartDate
      ? parseSyncBoundaryTime(this.scopeOptions.syncStartDate)
      : null;
    const maxDaysCutoff = this.scopeOptions.maxDays && this.scopeOptions.maxDays > 0
      ? Date.now() - this.scopeOptions.maxDays * 24 * 60 * 60 * 1000
      : null;
    const cutoffTime = [syncStartCutoff, maxDaysCutoff]
      .filter((t): t is number => t !== null)
      .reduce((max, t) => Math.max(max, t), 0) || null;
    let lastNoteTimestampTime: number | null = null;

    const cleanup = () => {
      this.cancelled = true;
      this.onCancel?.();
      if (!controller.signal.aborted) controller.abort();
    };
    modal?.setOnCancel(cleanup);

    try {
      const credentials = getAuthCredentials(this.settings);
      for await (const notes of fetchAllNotes(credentials.token, credentials.clientId, controller.signal, null, credentials.authMode)) {
        if (this.cancelled || modal?.isCancelled()) throw new SyncCancelledError();
        pageCount++;
        this.onProgress?.({ page: pageCount, percent: 0 });

        const recentNotes = this.filterRecentNotes(notes);
        const filtered = this.filterNotesByDateRangeOrMissingLocal(recentNotes, uidIndex, previouslySyncedNoteIds);
        const typeFiltered = this.filterNotesByType(filtered);
        for (const note of typeFiltered) {
          if (this.cancelled || modal?.isCancelled()) throw new SyncCancelledError();
          if (seenNoteIds.has(note.note_id)) continue;
          const parentMatchesTags = this.filterNotesByTags([note]).length > 0;
          const noteToWrite = await this.enrichAudioNote(note, controller.signal);

          const appendNotes = this.filterNotesByTags(await this.fetchAppendNotes(noteToWrite, controller.signal, result));
          if (!parentMatchesTags && appendNotes.length === 0) continue;
          const parentBaseName = this.buildBaseName(noteToWrite);
          const parentFileName = this.getFileName(noteToWrite);
          // 子文档完整文件名（用于父文档的 wiki 链接）
          const childFileNames = appendNotes.map(child => this.getFileName(child, parentBaseName));

          // 写入父文档（含子文档链接）
          if (parentMatchesTags) {
            seenNoteIds.add(note.note_id);
            result.total++;
            for (const tag of note.tags ?? []) {
              if (tag?.name) observedTagNames.add(tag.name);
            }
            const writeResult = await this.writeNote(noteToWrite, uidIndex, undefined, undefined, childFileNames);
            this.applyWriteResult(result, writeResult);
            this.recordItem(result, noteToWrite, writeResult);
          }

          // 写入子文档（链接回父文档）
          for (const appendNote of appendNotes) {
            if (seenNoteIds.has(appendNote.note_id)) continue;
            seenNoteIds.add(appendNote.note_id);
            result.total++;
            for (const tag of appendNote.tags ?? []) {
              if (tag?.name) observedTagNames.add(tag.name);
            }
            const appendWriteResult = await this.writeNote(
              appendNote,
              uidIndex,
              parentMatchesTags ? parentBaseName : undefined,
              parentMatchesTags ? parentFileName : undefined
            );
            this.applyWriteResult(result, appendWriteResult);
            this.recordItem(result, appendNote, appendWriteResult);
          }

          const updatedTime = parseNoteUpdatedTime(note);
          if (updatedTime !== null && (lastNoteTimestampTime === null || updatedTime > lastNoteTimestampTime)) {
            lastNoteTimestampTime = updatedTime;
            result.lastNoteTimestamp = note.updated_at;
          }
        }

        // List APIs page by created_at DESC. Once the oldest created note in this page
        // is older than the cutoff, later pages can be skipped after this page's
        // still-valid notes have been processed.
        if (cutoffTime !== null && notes.length > 0 && isSortedByCreatedDesc(notes)) {
          const oldestNote = notes[notes.length - 1];
          const oldestTime = parseNoteCreatedTime(oldestNote);
          if (oldestTime !== null && oldestTime < cutoffTime) {
            break;
          }
        }

        if (result.total % 10 === 0) {
          this.onProgress?.({
            page: pageCount,
            processed: result.total,
            total: result.total,
            created: result.created,
            updated: result.updated,
            skipped: result.skipped,
            failed: result.failed,
            percent: 0,
          });
        }
      }

      this.onProgress?.({ percent: 100 });
      // Cross-KB path: only run when the user has explicitly selected at least
      // one knowledge base. Empty array / undefined = cross-KB sync disabled.
      const selectedKnowledgeBases = this.scopeOptions.syncKnowledgeBases ?? [];
      if (selectedKnowledgeBases.length > 0) {
        await this.runCrossKnowledgeBaseSync(result, controller.signal);
      }

      if (observedTagNames.size > 0) {
        result.observedTags = Array.from(observedTagNames);
      }
      return result;
    } catch (err) {
      cleanup();
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new SyncCancelledError();
      }
      throw err;
    }
  }

  private async runCrossKnowledgeBaseSync(result: SyncResult, signal: AbortSignal): Promise<void> {
    const selectedKnowledgeBases = this.scopeOptions.syncKnowledgeBases ?? [];
    if (selectedKnowledgeBases.length === 0) return;

    const credentials = getAuthCredentials(this.settings);
    const entries = this.scopeOptions.knowledgeBaseEntries ?? [];
    const createdIds = new Set(entries.filter(entry => entry.source === 'created').map(entry => entry.topicId));
    const topicIds = selectedKnowledgeBases.filter(id => !createdIds.has(id));
    const createdTopicIds = selectedKnowledgeBases.filter(id => createdIds.has(id));
    const bloggerIds: string[] = [];

    const knowledgeNotes = await fetchSubscribedKnowledgeNotes({
      token: credentials.token,
      clientId: credentials.clientId,
      signal,
      authMode: credentials.authMode,
      topicIds,
      createdTopicIds,
      bloggerIds,
      onTopicError: (topic, error) => this.recordTopicFailure(result, topic, error),
    });

    const cutoffTime = this.scopeOptions.syncStartDate
      ? parseSyncBoundaryTime(this.scopeOptions.syncStartDate)
      : null;

    const filteredNotes = knowledgeNotes.filter(note => {
      if (cutoffTime === null) return true;
      const updated = parseNoteUpdatedTime(note);
      return updated !== null && updated >= cutoffTime;
    });

    const uidIndex = this.buildUidIndex();
    const seenNoteIds = new Set<string>();

    for (const note of filteredNotes) {
      if (this.cancelled) throw new SyncCancelledError();
      if (seenNoteIds.has(note.note_id)) continue;
      seenNoteIds.add(note.note_id);
      result.total++;
      const kb = this.resolveKb(note);
      const categoryOverride = kb.folder;
      const bloggerOverride = this.resolveBloggerSubfolder(note, categoryOverride);

      // Reuse the preCheckNote logic from the main sync path: if the note is
      // already up to date in the vault, skip it without re-running
      // enrichAudioNote. This is the same path used by syncNoteIds to avoid
      // missing audio/transcript/image attachment re-downloads.
      const preCheck = this.preCheckNote(note, uidIndex, bloggerOverride);
      const needsBackfill = preCheck.file
        ? await this.needsKnowledgeBaseBackfill(preCheck.file, note, kb.name)
        : false;
      if (preCheck.exists && !this.forceResync && !needsBackfill) {
        result.skipped++;
        this.recordItem(result, note, { status: 'skipped' });
        this.onProgress?.({
          processed: result.total,
          total: result.total,
          created: result.created,
          updated: result.updated,
          skipped: result.skipped,
          failed: result.failed,
          percent: 0,
        });
        continue;
      }

      const noteToWrite = await this.enrichAudioNote(note, signal, bloggerOverride);
      if (kb.name) noteToWrite.kbName = kb.name;
      const appendNotes = await this.fetchAppendNotes(noteToWrite, signal, result, bloggerOverride);
      if (kb.name) {
        for (const appendNote of appendNotes) appendNote.kbName = kb.name;
      }
      const parentBaseName = this.buildBaseName(noteToWrite);
      const parentFileName = this.getFileName(noteToWrite);
      const childFileNames = appendNotes.map(child => this.getFileName(child, parentBaseName));

      const writeResult = await this.writeNote(
        noteToWrite,
        uidIndex,
        undefined,
        undefined,
          childFileNames,
          bloggerOverride,
          needsBackfill
        );
      this.applyWriteResult(result, writeResult);
      this.recordItem(result, noteToWrite, writeResult);
      const updatedTime = parseNoteUpdatedTime(noteToWrite);
      const currentLastTime = result.lastNoteTimestamp ? parseSyncBoundaryTime(result.lastNoteTimestamp) : null;
      if (updatedTime !== null && (currentLastTime === null || updatedTime > currentLastTime)) {
        result.lastNoteTimestamp = noteToWrite.updated_at;
      }

      for (const appendNote of appendNotes) {
        const appendWriteResult = await this.writeNote(
          appendNote,
          uidIndex,
          parentBaseName,
          parentFileName,
          undefined,
          bloggerOverride
        );
        this.applyWriteResult(result, appendWriteResult);
        this.recordItem(result, appendNote, appendWriteResult);
      }

      this.onProgress?.({
        processed: result.total,
        total: result.total,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        failed: result.failed,
        percent: 0,
      });
    }
  }

  async syncNoteIds(
    noteIds: string[],
    modal?: SyncModal
  ): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0, skipped: 0, failed: 0, total: 0, items: [] };
    const uidIndex = this.buildUidIndex();
    const seenNoteIds = new Set<string>();
    const observedTagNames = new Set<string>();
    const controller = new AbortController();
    this.abortController = controller;
    this.cancelled = false;
    let processedCount = 0;

    const cleanup = () => {
      this.cancelled = true;
      if (!controller.signal.aborted) controller.abort();
    };
    modal?.setOnCancel(cleanup);

    try {
      const credentials = getAuthCredentials(this.settings);
      const orderedIds = noteIds.filter((id, index) => noteIds.indexOf(id) === index);

      for (const noteId of orderedIds) {
        if (this.cancelled || modal?.isCancelled()) throw new SyncCancelledError();
        if (seenNoteIds.has(noteId)) continue;
        seenNoteIds.add(noteId);

        let detail: Partial<GetNoteNote>;
        try {
          detail = await fetchNoteDetail(
            noteId,
            credentials.token,
            credentials.clientId,
            controller.signal,
            credentials.authMode
          );
        } catch (err) {
          result.failed++;
          const failedNote: GetNoteNote = {
            id: noteId,
            note_id: noteId,
            title: '',
            content: '',
            note_type: 'plain_text',
            tags: [],
            created_at: '',
            updated_at: '',
            source: '',
          };
          this.recordItem(result, failedNote, {
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          });
          console.warn(`[DedaoBrain] Failed to fetch note detail for ${noteId}:`, err);
          processedCount++;
          this.onProgress?.({ processed: processedCount, total: orderedIds.length, percent: Math.round((processedCount / orderedIds.length) * 100) });
          continue;
        }

        const note: GetNoteNote = {
          id: detail.id ?? noteId,
          note_id: detail.note_id ?? noteId,
          title: detail.title ?? '',
          content: detail.content ?? '',
          note_type: detail.note_type ?? 'plain_text',
          tags: detail.tags ?? [],
          created_at: detail.created_at ?? '',
          updated_at: detail.updated_at ?? '',
          source: detail.source ?? '',
          attachments: detail.attachments,
          audio: detail.audio,
          children_count: detail.children_count,
          children_ids: detail.children_ids,
          prime_id: (detail as { prime_id?: string }).prime_id,
          parent_id: detail.parent_id,
          topic_id: detail.topic_id,
          linkOriginal: detail.linkOriginal,
          is_child_note: detail.is_child_note,
        };

        const typeFiltered = this.filterNotesByType([note]);
        if (typeFiltered.length === 0) {
          processedCount++;
          this.onProgress?.({ processed: processedCount, total: orderedIds.length, percent: Math.round((processedCount / orderedIds.length) * 100) });
          continue;
        }

        const parentMatchesTags = this.filterNotesByTags(typeFiltered).length > 0;
        if (parentMatchesTags) {
          result.total++;
          for (const tag of typeFiltered[0].tags ?? []) {
            if (tag?.name) observedTagNames.add(tag.name);
          }
          processedCount++;
          const percent = Math.round((processedCount / orderedIds.length) * 100);
          this.onProgress?.({ processed: processedCount, total: orderedIds.length, percent });
        }
        // Pre-check: skip if the same note already exists locally.
        // Uses UID-based lookup so renamed/moved files are still found.
        const preCheck = this.preCheckNote(typeFiltered[0], uidIndex);
        if (preCheck.exists && !this.forceResync) {
          if (parentMatchesTags) {
            result.skipped++;
            this.recordItem(result, typeFiltered[0], { status: 'skipped' });
          }
          const mayHaveAppendNotes = (typeFiltered[0].children_count ?? 0) > 0 || Boolean(typeFiltered[0].children_ids?.length);
          if (!mayHaveAppendNotes) {
            continue;
          }
        }
        const noteToWrite = await this.enrichAudioNote(typeFiltered[0], controller.signal);

        const appendNotes = this.filterNotesByTags(await this.fetchAppendNotes(noteToWrite, controller.signal, result));
        if (!parentMatchesTags && appendNotes.length === 0) continue;
        const parentBaseName = this.buildBaseName(noteToWrite);
        const parentFileName = this.getFileName(noteToWrite);
        const childFileNames = appendNotes.map(child => this.getFileName(child, parentBaseName));

        if (parentMatchesTags && !preCheck.exists) {
          const writeResult = await this.writeNote(noteToWrite, uidIndex, undefined, parentFileName, childFileNames);
          this.applyWriteResult(result, writeResult);
          this.recordItem(result, noteToWrite, writeResult);
        }

        // 写入子文档（链接回父文档）
        for (const appendNote of appendNotes) {
          if (seenNoteIds.has(appendNote.note_id)) continue;
          seenNoteIds.add(appendNote.note_id);
          result.total++;
          for (const tag of appendNote.tags ?? []) {
            if (tag?.name) observedTagNames.add(tag.name);
          }
          const appendWriteResult = await this.writeNote(
            appendNote,
            uidIndex,
            parentMatchesTags ? parentBaseName : undefined,
            parentMatchesTags ? parentFileName : undefined
          );
          this.applyWriteResult(result, appendWriteResult);
          this.recordItem(result, appendNote, appendWriteResult);
        }
      }

      this.onProgress?.({ percent: 100 });
      if (observedTagNames.size > 0) {
        result.observedTags = Array.from(observedTagNames);
      }
      return result;
    } catch (err) {
      cleanup();
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new SyncCancelledError();
      }
      throw err;
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }

  async syncSubscribedKnowledge(modal?: SyncModal, options?: string[] | SubscribedKnowledgeSyncOptions): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0, skipped: 0, failed: 0, total: 0, items: [] };
    const uidIndex = this.buildUidIndex();
    const seenNoteIds = new Set<string>();
    const observedTagNames = new Set<string>();
    const controller = new AbortController();
    this.abortController = controller;
    this.cancelled = false;

    const cleanup = () => {
      this.cancelled = true;
      this.onCancel?.();
      if (!controller.signal.aborted) controller.abort();
    };
    modal?.setOnCancel(cleanup);

    try {
      const credentials = getAuthCredentials(this.settings);
      const syncOptions: SubscribedKnowledgeSyncOptions = Array.isArray(options)
        ? { selectedNoteIds: options }
        : options ?? {};
      const selectedNoteIds = syncOptions.selectedNoteIds;
      if (selectedNoteIds?.length === 0) {
        this.onProgress?.({ percent: 100 });
        return result;
      }

      const processNotes = async (notes: GetNoteNote[]): Promise<void> => {
        const noteIdFiltered = selectedNoteIds
          ? notes.filter(n => selectedNoteIds.includes(n.note_id))
          : notes;
        const filteredNotes = selectedNoteIds || syncOptions.syncAll
          ? noteIdFiltered
          : this.filterNotesByDateRange(this.filterRecentNotes(noteIdFiltered));

        for (const note of filteredNotes) {
          if (this.cancelled || modal?.isCancelled()) throw new SyncCancelledError();
          if (seenNoteIds.has(note.note_id)) continue;
          const parentMatchesTags = this.filterNotesByTags([note], syncOptions.syncTags).length > 0;
          const kb = this.resolveKbForSubscribedSync(note, syncOptions);
          const categoryOverride = kb.folder;
          const bloggerOverride = this.resolveBloggerSubfolder(note, categoryOverride);
          const noteToWrite = await this.enrichAudioNote(note, controller.signal, bloggerOverride);
          if (kb.name) noteToWrite.kbName = kb.name;
          const appendNotes = this.filterNotesByTags(
            await this.fetchAppendNotes(noteToWrite, controller.signal, result, bloggerOverride),
            syncOptions.syncTags
          );
          if (kb.name) {
            for (const appendNote of appendNotes) appendNote.kbName = kb.name;
          }
          if (!parentMatchesTags && appendNotes.length === 0) continue;
          const parentBaseName = this.buildBaseName(noteToWrite);
          const parentFileName = this.getFileName(noteToWrite);
          const childFileNames = appendNotes.map(child => this.getFileName(child, parentBaseName));
          if (parentMatchesTags) {
            seenNoteIds.add(note.note_id);
            result.total++;
            for (const tag of note.tags ?? []) {
              if (tag?.name) observedTagNames.add(tag.name);
            }
            const writeResult = await this.writeNote(
              noteToWrite,
              uidIndex,
              undefined,
              undefined,
              childFileNames,
              bloggerOverride
            );
            this.applyWriteResult(result, writeResult);
            this.recordItem(result, noteToWrite, writeResult);
          }
          for (const appendNote of appendNotes) {
            seenNoteIds.add(appendNote.note_id);
            result.total++;
            for (const tag of appendNote.tags ?? []) {
              if (tag?.name) observedTagNames.add(tag.name);
            }
            const appendWriteResult = await this.writeNote(
              appendNote,
              uidIndex,
              parentMatchesTags ? parentBaseName : undefined,
              parentMatchesTags ? parentFileName : undefined,
              undefined,
              bloggerOverride
            );
            this.applyWriteResult(result, appendWriteResult);
            this.recordItem(result, appendNote, appendWriteResult);
          }
          this.onProgress?.({
            processed: result.total,
            total: result.total,
            created: result.created,
            updated: result.updated,
            skipped: result.skipped,
            failed: result.failed,
            percent: 0,
          });
        }
      };

      const returnedNotes = await fetchSubscribedKnowledgeNotes({
        token: credentials.token,
        clientId: credentials.clientId,
        signal: controller.signal,
        authMode: credentials.authMode,
        topicIds: syncOptions.topicIds,
        createdTopicIds: syncOptions.createdTopicIds,
        bloggerIds: syncOptions.bloggerIds,
        selectedNoteIds,
        onNotes: processNotes,
        onTopicError: (topic, error) => this.recordTopicFailure(result, topic, error),
      });
      await processNotes(returnedNotes);

      this.onProgress?.({ percent: 100 });
      if (observedTagNames.size > 0) {
        result.observedTags = Array.from(observedTagNames);
      }
      return result;
    } catch (err) {
      cleanup();
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new SyncCancelledError();
      }
      throw err;
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
      }
    }
  }
}
