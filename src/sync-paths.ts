import { t } from './i18n';
import { generateDisplayTitle, formatTimestampPrefix } from './note-parser';
import type { GetNoteNote, Settings } from './types';

export function getKnowledgeBaseDir(name: string): string {
  const safeName = name.replace(/[\\/:*?"<>|]/g, '_').trim() || t('picker.noTitle');
  return `知识库/${safeName}`;
}

/** 标题日期与记录时间相差超过这个天数，判定为笔误，改用记录时间 */
const TITLE_DATE_MAX_DRIFT_DAYS = 30;

/**
 * 解析标题开头用户手写的日期。
 *
 * 覆盖格式：
 *   2026年7月25日 / 2026年07月25日 / 2026 年 7 月 25 日
 *   2026-07-25 / 2026/07/25 / 2026.7.25
 *   20260728（8 位连写，后面不能紧跟数字）
 * 日期后紧随的分隔符（空格 / 下划线 / 短横线 / 破折号 / 冒号 / 顿号等）一并去掉。
 *
 * @returns iso  归一化的 YYYY-MM-DD；标题没有日期时为 null
 * @returns rest 去掉日期后的标题；若剥离后为空则回退原标题，避免生成空文件名
 */
export function extractLeadingDate(title: string): { iso: string | null; rest: string } {
  const patterns: Array<{ re: RegExp; y: number; m: number; d: number }> = [
    { re: /^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/, y: 1, m: 2, d: 3 },
    { re: /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/, y: 1, m: 2, d: 3 },
    { re: /^(\d{4})(\d{2})(\d{2})(?!\d)/, y: 1, m: 2, d: 3 },
  ];

  for (const { re, y, m, d } of patterns) {
    const matched = title.match(re);
    if (!matched) continue;

    const month = Number(matched[m]);
    const day = Number(matched[d]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;

    const iso = `${matched[y]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    // 日期区间写法（20260730-0731 / 2026-07-30~31）：把区间尾巴一并吃掉
    const rest = title
      .slice(matched[0].length)
      .replace(/^\s*[-–—~至到]\s*\d{2,4}(?!\d)/, '')
      .replace(/^[\s_\-–—·:：,，、|]+/, '')
      .trim();
    return { iso, rest: rest || title.trim() };
  }

  return { iso: null, rest: title.trim() };
}

/** 保留旧导出名，等价于只取 rest */
export function stripLeadingDate(title: string): string {
  return extractLeadingDate(title).rest;
}

function daysBetween(isoA: string, isoB: string): number {
  const a = Date.parse(`${isoA}T00:00:00Z`);
  const b = Date.parse(`${isoB}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / 86_400_000;
}

/**
 * 决定文件名前缀该用哪个时间。
 *
 * 标题里手写的日期代表「事情发生的日期」，created_at 代表「录入系统的时间」，
 * 两者语义不同（深夜补记会差一天，提前写计划会早几天）。标题有日期时以标题为准，
 * 但偏差超过 30 天视为笔误（如把 2026 写成 2016），回退到 created_at。
 */
function resolvePrefixSource(titleIso: string | null, createdAt: string): string {
  if (!titleIso) return createdAt;

  const createdIso = createdAt.slice(0, 10);
  // 日期用标题的，时分秒仍沿用记录时间，保证 HH/mm/ss token 仍有意义
  const timePart = createdAt.slice(10) || ' 00:00:00';

  if (daysBetween(titleIso, createdIso) <= TITLE_DATE_MAX_DRIFT_DAYS) {
    return `${titleIso}${timePart}`;
  }

  // 偏差过大多半是年份写错（把 2026 敲成 2016）。先只改年份再判一次，
  // 月日通常是对的，这样比整条回退 created 更贴近原意。
  const repaired = `${createdIso.slice(0, 4)}${titleIso.slice(4)}`;
  if (daysBetween(repaired, createdIso) <= TITLE_DATE_MAX_DRIFT_DAYS) {
    return `${repaired}${timePart}`;
  }

  return createdAt;
}

export function buildNoteBaseName(note: GetNoteNote, settings: Pick<Settings, 'filenamePrefix'>): string {
  const rawTitle = generateDisplayTitle(note);
  const displayTitle = rawTitle || t('picker.noTitle');
  const prefix = settings.filenamePrefix?.trim();
  if (!prefix) return displayTitle;

  const hasTimestampTokens = /YYYY|MM|DD|HH|mm|ss/.test(prefix);
  if (hasTimestampTokens) {
    // 标题自带日期时以它为准并剥离，避免「2026年07月25日_2026年7月25日 xxx」
    const { iso: titleIso, rest: bareTitle } = extractLeadingDate(displayTitle);
    const source = resolvePrefixSource(titleIso, note.created_at);

    const formattedPrefix = formatTimestampPrefix(prefix, source);
    if (!formattedPrefix) {
      return displayTitle;
    }
    const separator = formattedPrefix.endsWith('_') ? '' : '_';
    return `${formattedPrefix}${separator}${bareTitle}`;
  }

  const separator = prefix.endsWith('_') ? '' : '_';
  return `${prefix}${separator}${displayTitle}`;
}

export function getFileName(note: GetNoteNote, settings: Pick<Settings, 'filenamePrefix'>, parentBaseName?: string): string {
  if (parentBaseName) {
    const childTitle = generateDisplayTitle(note) || t('picker.noTitle');
    return `${parentBaseName}__${childTitle}`;
  }
  return buildNoteBaseName(note, settings);
}

export function getAudioAssetBaseName(note: GetNoteNote, settings: Pick<Settings, 'filenamePrefix'>): string {
  const safeNoteId = note.note_id.replace(/[\\/:*?"<>|]/g, '_');
  return `${getFileName(note, settings)}_${safeNoteId}`;
}

export function getFilePath(categoryDir: string, note: GetNoteNote, settings: Pick<Settings, 'filenamePrefix'>): string {
  return `${categoryDir}/${getFileName(note, settings)}.md`;
}
