/**
 * 历史博主笔记回填脚本（一次性工具，不进插件 main.js）
 *
 * 作用：复用插件源码的纯逻辑（OpenAPI 鉴权 / 博主帖拉取 / 笔记渲染 / 文件名），
 * 把「00-Inbox/00-订阅知识博主知识库/」下缺逐字稿的旧版总结笔记，
 * 重拉详情（post_media_text 逐字稿 + post_summary AI摘要），按博主名落子文件夹。
 *
 * 设计：
 *  - 从 data.json 只读 token/clientId/folderName/filenamePrefix，绝不写回。
 *  - 三种模式：
 *      fetch                        拉取全部博主帖（含逐字稿）存缓存 notes-cache.json
 *      write [N]                   从缓存全量写盘（前 N 篇可只写前 N 验证）
 *      deficient [dry]             扫描本地「正文偏短、疑似缺逐字稿」的笔记，
 *                                  只对这些 uid 重拉详情，仅覆盖确实有逐字稿的；
 *                                  dry = 只报告、不写盘。
 *
 * 用法：
 *  node backfill.cjs fetch
 *  node backfill.cjs write 3
 *  node backfill.cjs write
 *  node backfill.cjs deficient dry     # 先预览会改哪些
 *  node backfill.cjs deficient         # 只补缺失逐字稿的那几十篇
 */
import { fetchSubscribedKnowledgeNotes, fetchSubscribedTopics } from '../src/api-clients/openapi-client';
import { renderNote } from '../src/note-parser';
import { getFileName } from '../src/sync-paths';
import * as fs from 'fs';
import * as path from 'path';

// Node 里没有 window，openapi-client 的 knowledgeApiRequest 用到 window.setTimeout/clearTimeout
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;

// 本地 vault 根目录：必须通过环境变量 DEDAO_VAULT 提供（不写死任何个人路径，发布版/开源版不含机器特定路径）
const VAULT = process.env.DEDAO_VAULT;
if (!VAULT) { console.error('[backfill] 请先设置环境变量 DEDAO_VAULT 指向你的 vault 根目录，例如：export DEDAO_VAULT=/path/to/vault'); process.exit(1); }
const PLUGIN_DIR = path.join(VAULT, '.obsidian/plugins/dedao-kb-sync');
const CACHE = path.join(__dirname, 'notes-cache.json');
const KB_FALLBACK = '00-订阅知识博主知识库';
const DEFICIENT_BODY_THRESHOLD = 500; // 本地正文（去 frontmatter）短于此值，视为疑似缺逐字稿

function sanitize(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').trim() || '未知博主';
}

function walkMd(d: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push(...walkMd(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function stripFrontmatter(s: string): string {
  return s.replace(/^---[\s\S]*?---/, '');
}

function parseUid(s: string): string | null {
  const m = s.match(/^uid:\s*"([^"]+)"/m);
  return m ? m[1] : null;
}

async function loadSettings() {
  const s = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'data.json'), 'utf8'));
  return {
    token: s.openApiToken || s.apiToken,
    clientId: s.openApiClientId || s.clientId,
    folderName: s.folderName || '00-Inbox',
    filenamePrefix: s.filenamePrefix || 'YYYY年MM月DD日',
  };
}

async function fetchAll(settings: { token: string; clientId: string }) {
  const topics = await fetchSubscribedTopics(settings.token, settings.clientId);
  const topicMap = new Map<string, string>();
  for (const t of topics) topicMap.set(t.topic_id, t.name || KB_FALLBACK);
  const notes = await fetchSubscribedKnowledgeNotes({ token: settings.token, clientId: settings.clientId });
  const out = { topicMap: Array.from(topicMap.entries()), notes };
  fs.writeFileSync(CACHE, JSON.stringify(out));
  const bloggers = notes.filter((n: { note_type: string }) => n.note_type === 'blogger_post');
  console.log(`拉取完成：总 ${notes.length}，博主帖 ${bloggers.length}，订阅专题 ${topics.length}`);
}

/** 扫描本地博主笔记，返回正文偏短（疑似缺逐字稿）的 uid 列表 */
function findDeficientUids(folderName: string): Array<{ uid: string; file: string; bodyLen: number }> {
  const kbRoot = path.join(VAULT, folderName, KB_FALLBACK);
  if (!fs.existsSync(kbRoot)) return [];
  const result: Array<{ uid: string; file: string; bodyLen: number }> = [];
  for (const f of walkMd(kbRoot)) {
    const s = fs.readFileSync(f, 'utf8');
    const uid = parseUid(s);
    if (!uid) continue;
    const bodyLen = stripFrontmatter(s).trim().length;
    if (bodyLen < DEFICIENT_BODY_THRESHOLD) result.push({ uid, file: f, bodyLen });
  }
  return result;
}

/** 写单篇笔记到 <folderName>/<kbName>/<blogger>/<fileName>.md（覆盖） */
function writeNote(
  note: Record<string, unknown>,
  settings: { folderName: string; filenamePrefix: string },
  topicMap: Map<string, string>
): { written: boolean; migrated: boolean } {
  const noteId = String(note.note_id);
  const topicId = String(note.topic_id ?? '');
  const kbName = topicMap.get(topicId) || KB_FALLBACK;
  const blogger = sanitize(String((note as { bloggerName?: string }).bloggerName || '未知博主'));
  const base = path.join(VAULT, settings.folderName, kbName);
  const targetDir = path.join(base, blogger);
  fs.mkdirSync(targetDir, { recursive: true });
  const fileName = getFileName(note as never, { filenamePrefix: settings.filenamePrefix });
  const content = renderNote(note as never);
  const targetPath = path.join(targetDir, `${fileName}.md`);
  const oldPath = path.join(base, `${fileName}.md`);
  fs.writeFileSync(targetPath, content, 'utf8');
  let migrated = false;
  if (oldPath !== targetPath && fs.existsSync(oldPath)) {
    const old = fs.readFileSync(oldPath, 'utf8');
    const m = old.match(/^uid:\s*"([^"]+)"/m);
    if (m && m[1] === noteId) { fs.unlinkSync(oldPath); migrated = true; }
  }
  return { written: true, migrated };
}

function writeFromCache(settings: { folderName: string; filenamePrefix: string }, limit?: number) {
  const raw = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  const topicMap = new Map<string, string>(raw.topicMap);
  const notes: Array<Record<string, unknown>> = raw.notes;
  const bloggers = notes.filter((n) => n.note_type === 'blogger_post');
  const limitN = limit ?? bloggers.length;
  let written = 0, migrated = 0, skipped = 0, errors = 0;
  const seen = new Set<string>();
  for (const note of bloggers) {
    const noteId = String(note.note_id);
    if (seen.has(noteId)) { skipped++; continue; }
    seen.add(noteId);
    if (written >= limitN) { skipped++; continue; }
    try {
      const r = writeNote(note, settings, topicMap);
      written++;
      if (r.migrated) migrated++;
    } catch (e) {
      errors++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error('写失败', noteId, msg);
    }
  }
  console.log(`写 ${written}，迁移删旧 ${migrated}，跳过 ${skipped}，失败 ${errors}`);
}

async function backfillDeficient(settings: { token: string; clientId: string; folderName: string; filenamePrefix: string }, dry: boolean) {
  const deficient = findDeficientUids(settings.folderName);
  console.log(`本地疑似缺逐字稿（正文<${DEFICIENT_BODY_THRESHOLD}字）: ${deficient.length} 篇`);
  if (deficient.length === 0) return;
  const uids = deficient.map((d) => d.uid);
  console.log('重拉详情中（仅这些 uid）...');
  const notes = await fetchSubscribedKnowledgeNotes({ token: settings.token, clientId: settings.clientId, selectedNoteIds: uids });
  const topicMap = new Map<string, string>(); // 详情接口已含 topic_id，写文件时回退到 KB_FALLBACK 即可
  // 仍需 topic 名映射：从缓存或重新拉取
  let nameMap = topicMap;
  if (fs.existsSync(CACHE)) {
    try { nameMap = new Map<string, string>(JSON.parse(fs.readFileSync(CACHE, 'utf8')).topicMap); } catch { /* ignore */ }
  }
  let written = 0, skippedNoTranscript = 0, errors = 0;
  const fetchedIds = new Set(notes.map((n) => String((n as { note_id: string }).note_id)));
  for (const d of deficient) {
    if (!fetchedIds.has(d.uid)) { console.error('未拉到（可能已下架/无权限）:', d.uid); skippedNoTranscript++; continue; }
  }
  for (const note of notes) {
    const noteId = String((note as { note_id: string }).note_id);
    if (!uids.includes(noteId)) continue;
    const mediaText = (note as { post_media_text?: string }).post_media_text;
    if (!mediaText || !mediaText.trim()) {
      // API 侧也无逐字稿，跳过（避免用空内容覆盖）
      skippedNoTranscript++;
      console.log('  API 也无逐字稿，跳过:', noteId);
      continue;
    }
    if (dry) { console.log('  [dry] 将写入:', noteId); continue; }
    try {
      writeNote(note as unknown as Record<string, unknown>, settings, nameMap);
      written++;
    } catch (e) {
      errors++;
      const msg = e instanceof Error ? e.message : String(e);
      console.error('写失败', noteId, msg);
    }
  }
  console.log(`deficient 完成：写入 ${written}，跳过(无逐字稿/未拉到) ${skippedNoTranscript}，失败 ${errors}`);
}

(async () => {
  const settings = await loadSettings();
  const cmd = process.argv[2];
  const arg = process.argv[3];
  if (cmd === 'fetch' || (!fs.existsSync(CACHE) && cmd !== 'deficient')) {
    await fetchAll(settings);
  }
  if (cmd === 'fetch') return;
  if (cmd === 'write') {
    const lim = arg ? Number(arg) : undefined;
    writeFromCache(settings, lim);
    return;
  }
  if (cmd === 'deficient') {
    await backfillDeficient(settings, arg === 'dry');
    return;
  }
  if (cmd === undefined) {
    writeFromCache(settings);
  }
})();
