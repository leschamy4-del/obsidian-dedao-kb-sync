#!/usr/bin/env node
/**
 * 得到大脑笔记文件名迁移脚本
 *
 * 把已同步的笔记重命名为「YYYY年MM月DD日_主题」，日期取 frontmatter 里的 created 时间。
 * 标题里手写的日期会被剥离，避免重复。
 *
 * 用法：
 *   node migrate-filenames.mjs <vault> <targetFolder>            # 预演（默认，不改动任何文件）
 *   node migrate-filenames.mjs <vault> <targetFolder> --apply    # 实际执行
 */

import fs from 'node:fs';
import path from 'node:path';

const [, , vaultArg, folderArg, ...flags] = process.argv;
const APPLY = flags.includes('--apply');

if (!vaultArg || !folderArg) {
  console.error('用法: node migrate-filenames.mjs <vault> <targetFolder> [--apply]');
  process.exit(1);
}

const VAULT = path.resolve(vaultArg);
const TARGET = path.join(VAULT, folderArg);

/** 与插件 src/sync-paths.ts 保持一致 */
const TITLE_DATE_MAX_DRIFT_DAYS = 30;

function extractLeadingDate(title) {
  const patterns = [
    { re: /^(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/ },
    { re: /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/ },
    { re: /^(\d{4})(\d{2})(\d{2})(?!\d)/ },
  ];
  for (const { re } of patterns) {
    const matched = title.match(re);
    if (!matched) continue;
    const month = Number(matched[2]);
    const day = Number(matched[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const iso = `${matched[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const rest = title
      .slice(matched[0].length)
      .replace(/^\s*[-–—~至到]\s*\d{2,4}(?!\d)/, '')
      .replace(/^[\s_\-–—·:：,，、|]+/, '')
      .trim();
    return { iso, rest: rest || title.trim() };
  }
  return { iso: null, rest: title.trim() };
}

function daysBetween(isoA, isoB) {
  const a = Date.parse(`${isoA}T00:00:00Z`);
  const b = Date.parse(`${isoB}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / 86_400_000;
}

/** 标题日期优先（代表事情发生日），偏差超 30 天视为笔误回退 created */
function resolveDateIso(titleIso, createdIso) {
  if (!titleIso) return { iso: createdIso, from: 'created' };
  if (daysBetween(titleIso, createdIso) <= TITLE_DATE_MAX_DRIFT_DAYS) {
    return { iso: titleIso, from: 'title' };
  }
  // 偏差过大多半是年份写错，先只改年份再判一次
  const repaired = `${createdIso.slice(0, 4)}${titleIso.slice(4)}`;
  if (daysBetween(repaired, createdIso) <= TITLE_DATE_MAX_DRIFT_DAYS) {
    return { iso: repaired, from: 'created(年份笔误已修正)' };
  }
  return { iso: createdIso, from: 'created(标题日期偏差过大，判定笔误)' };
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function readFrontmatter(content) {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end < 0) return null;
  const block = content.slice(3, end);
  const fm = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return fm;
}

function formatDatePrefix(iso) {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[1]}年${m[2]}月${m[3]}日`;
}

// ---------- 1. 收集待迁移文件 ----------
if (!fs.existsSync(TARGET)) {
  console.error(`目标文件夹不存在: ${TARGET}`);
  process.exit(1);
}

const allTargetFiles = walk(TARGET);
const plans = [];
const skipped = [];
const noDate = [];

for (const file of allTargetFiles) {
  const content = fs.readFileSync(file, 'utf8');
  if (!content.includes('source: 得到大脑')) continue;

  const fm = readFrontmatter(content);
  const created = fm?.created;
  const oldBase = path.basename(file, '.md');
  const createdIso = created ? String(created).slice(0, 10) : null;

  const { iso: titleIso, rest: bareTitle } = extractLeadingDate(oldBase);

  if (!createdIso && !titleIso) {
    noDate.push({ file, oldBase, reason: created ? `created 格式异常: ${created}` : '缺少 created 字段' });
    continue;
  }

  const { iso, from } = resolveDateIso(titleIso, createdIso);
  const prefix = formatDatePrefix(iso);
  if (!prefix) {
    noDate.push({ file, oldBase, reason: `日期解析失败: ${iso}` });
    continue;
  }

  const newBase = `${prefix}_${bareTitle}`;

  if (newBase === oldBase) {
    skipped.push({ file, oldBase, reason: '已符合命名规则' });
    continue;
  }

  plans.push({ file, dir: path.dirname(file), oldBase, newBase, uid: fm?.uid ?? '', from });
}

// ---------- 2. 冲突检测 ----------
const takenPerDir = new Map();
for (const f of allTargetFiles) {
  const d = path.dirname(f);
  if (!takenPerDir.has(d)) takenPerDir.set(d, new Set());
  takenPerDir.get(d).add(path.basename(f, '.md'));
}

const conflicts = [];
for (const plan of plans) {
  const taken = takenPerDir.get(plan.dir);
  taken.delete(plan.oldBase); // 自身让位
  let candidate = plan.newBase;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${plan.newBase}-${suffix++}`;
  }
  if (candidate !== plan.newBase) {
    conflicts.push({ ...plan, resolved: candidate });
    plan.newBase = candidate;
  }
  taken.add(candidate);
}

// ---------- 3. 全 vault wikilink 引用统计 ----------
const renameMap = new Map(plans.map(p => [p.oldBase, p.newBase]));
const allVaultFiles = walk(VAULT);
const linkEdits = [];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

for (const file of allVaultFiles) {
  const content = fs.readFileSync(file, 'utf8');
  let updated = content;
  let hits = 0;

  for (const [oldBase, newBase] of renameMap) {
    // 匹配 [[oldBase]] / [[oldBase|别名]] / [[oldBase#标题]] / ![[oldBase]]
    const re = new RegExp(`(!?\\[\\[)${escapeRe(oldBase)}(?=[\\]|#^])`, 'g');
    const before = updated;
    updated = updated.replace(re, `$1${newBase}`);
    if (updated !== before) hits++;
  }

  if (hits > 0) linkEdits.push({ file, hits, content: updated });
}

// ---------- 4. 输出报告 ----------
const rel = p => path.relative(VAULT, p);
const lines = [];
lines.push(`# 得到大脑笔记文件名迁移${APPLY ? '结果' : '预演'}报告`);
lines.push('');
lines.push(`- Vault：\`${VAULT}\``);
lines.push(`- 目标文件夹：\`${folderArg}\``);
lines.push(`- 模式：**${APPLY ? '实际执行' : '预演（未改动任何文件）'}**`);
lines.push('');
lines.push('## 汇总');
lines.push('');
lines.push('| 项目 | 数量 |');
lines.push('| --- | --- |');
lines.push(`| 将重命名 | ${plans.length} |`);
lines.push(`| 已符合规则、跳过 | ${skipped.length} |`);
lines.push(`| 无法取得日期、跳过 | ${noDate.length} |`);
lines.push(`| 重名冲突（已自动加序号） | ${conflicts.length} |`);
lines.push(`| 需要更新内部链接的文件 | ${linkEdits.length} |`);
lines.push('');
const fromTitle = plans.filter(p => p.from === 'title');
const fromTypo = plans.filter(p => p.from && p.from.startsWith('created(') );
lines.push('日期取值来源：');
lines.push('');
lines.push(`- 取自标题手写日期（事情发生日）：**${fromTitle.length}** 篇`);
lines.push(`- 取自系统记录时间 created：**${plans.length - fromTitle.length - fromTypo.length}** 篇`);
lines.push(`- 标题日期偏差过大判定笔误、改用 created：**${fromTypo.length}** 篇`);
lines.push('');
if (fromTypo.length) {
  for (const p of fromTypo) lines.push(`  - \`${p.oldBase}\` → \`${p.newBase}\``);
  lines.push('');
}

if (noDate.length) {
  lines.push('## ⚠️ 无法取得日期（保持原名）');
  lines.push('');
  for (const n of noDate) lines.push(`- \`${rel(n.file)}\` — ${n.reason}`);
  lines.push('');
}

if (conflicts.length) {
  lines.push('## ⚠️ 重名冲突（已自动加序号）');
  lines.push('');
  for (const c of conflicts) lines.push(`- \`${c.oldBase}\` → \`${c.resolved}\``);
  lines.push('');
}

lines.push('## 完整改名清单');
lines.push('');
const byDir = new Map();
for (const p of plans) {
  const d = rel(p.dir);
  if (!byDir.has(d)) byDir.set(d, []);
  byDir.get(d).push(p);
}
for (const [dir, items] of [...byDir.entries()].sort()) {
  lines.push(`### ${dir}（${items.length} 篇）`);
  lines.push('');
  for (const p of items) {
    lines.push(`- \`${p.oldBase}\``);
    lines.push(`  → \`${p.newBase}\``);
  }
  lines.push('');
}

if (skipped.length) {
  lines.push('## 已符合规则、跳过');
  lines.push('');
  for (const s of skipped) lines.push(`- \`${s.oldBase}\``);
  lines.push('');
}

// ---------- 5. 执行 ----------
if (APPLY) {
  // 1) 先更新全 vault 内部链接：此时所有文件仍在原路径，链接引用的是 oldBase，写回不会错位
  for (const edit of linkEdits) {
    fs.writeFileSync(edit.file, edit.content, 'utf8');
  }
  // 2) 再执行重命名（被改名文件若自身含 wikilink，上一步已在其原路径写入更新后的内容）
  let renamed = 0;
  for (const plan of plans) {
    const from = plan.file;
    const to = path.join(plan.dir, `${plan.newBase}.md`);
    if (fs.existsSync(to)) {
      console.error(`跳过（目标已存在）: ${rel(to)}`);
      continue;
    }
    fs.renameSync(from, to);
    renamed++;
  }
  lines.push('## 执行结果');
  lines.push('');
  lines.push(`- 实际重命名：**${renamed}** 篇`);
  lines.push(`- 更新内部链接文件：**${linkEdits.length}** 个`);
  lines.push('');
  console.log(`已重命名 ${renamed} 篇，更新链接 ${linkEdits.length} 个文件`);
} else {
  console.log(`预演完成：将重命名 ${plans.length} 篇，跳过 ${skipped.length} 篇，无日期 ${noDate.length} 篇，链接待更新 ${linkEdits.length} 个文件`);
}

const reportPath = path.join(process.cwd(), APPLY ? 'migration-result.md' : 'migration-preview.md');
fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
console.log(`报告已写入: ${reportPath}`);
