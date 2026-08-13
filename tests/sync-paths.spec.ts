import { describe, expect, it } from 'vitest';
import { buildNoteBaseName, extractLeadingDate, getAudioAssetBaseName, getFileName, getFilePath, getKnowledgeBaseDir, stripLeadingDate } from '../src/sync-paths';
import type { GetNoteNote, Settings } from '../src/types';
import { DEFAULT_SETTINGS } from '../src/types';

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULT_SETTINGS,
    authMode: 'openapi',
    openApiToken: '',
    openApiClientId: '',
    webApiToken: '',
    apiToken: 'test-token',
    clientId: 'test-client',
    webCsrfToken: '',
    folderName: '得到大脑',
    templateFilePath: '',
    maxDays: 30,
    syncStartDate: '',
    lastSyncEndTimestamp: '',
    filenamePrefix: '',
    scheduledSync: { enabled: false, intervalMinutes: 30, syncOnStart: false },
    syncHistory: [],
    ...overrides,
  };
}

function makeNote(overrides: Partial<GetNoteNote> = {}): GetNoteNote {
  return {
    id: 1,
    note_id: 'note_001',
    title: '测试笔记',
    content: '正文内容',
    note_type: 'plain_text',
    source: 'app',
    tags: [],
    created_at: '2026-04-27T22:26:17+08:00',
    updated_at: '2026-04-28T10:00:00+08:00',
    ...overrides,
  };
}

describe('sync path helpers', () => {
  it('derives note filenames from the display title when no prefix is configured', () => {
    expect(getFileName(makeNote({ title: '我的笔记' }), makeSettings({ filenamePrefix: '' }))).toBe('我的笔记');
  });

  it('derives note filenames with formatted timestamp prefixes', () => {
    expect(getFileName(makeNote({ title: '我的笔记' }), makeSettings({ filenamePrefix: 'YYYY-MM-DD' }))).toBe('2026-04-27_我的笔记');
  });

  it('falls back to the display title when a timestamp prefix cannot be formatted', () => {
    expect(getFileName(makeNote({ title: '我的笔记', created_at: 'invalid' }), makeSettings({ filenamePrefix: 'YYYY-MM-DD' }))).toBe('我的笔记');
  });

  it('derives child note filenames from the parent base name and child title', () => {
    const settings = makeSettings({ filenamePrefix: 'getnote' });
    const child = makeNote({
      title: '原笔记标题',
      note_id: '1909246675068292528',
      parent_id: '1909193892067130512',
      is_child_note: true,
    });

    expect(getFileName(child, settings)).toBe('getnote_原笔记标题');
    expect(getFileName(child, settings, 'getnote_主笔记标题')).toBe('getnote_主笔记标题__原笔记标题');
  });

  it('derives vault and asset paths without changing existing naming rules', () => {
    const note = makeNote({ note_id: 'audio:001', title: '录音/标题' });
    const settings = makeSettings({ filenamePrefix: '' });

    expect(buildNoteBaseName(note, settings)).toBe('录音标题');
    expect(getFilePath('得到大脑/录音笔记', note, settings)).toBe('得到大脑/录音笔记/录音标题.md');
    expect(getAudioAssetBaseName(note, settings)).toBe('录音标题_audio_001');
  });

  it('derives knowledge base directories with the legacy unsafe-character replacement', () => {
    expect(getKnowledgeBaseDir('A/B:C*D?E"F<G>H|I')).toBe('知识库/A_B_C_D_E_F_G_H_I');
    expect(getKnowledgeBaseDir('   ')).toBe('知识库/(无标题)');
  });
});

describe('extractLeadingDate', () => {
  it('parses Chinese year-month-day at the start', () => {
    expect(extractLeadingDate('2026年7月25日 维苏威安全文化评估')).toEqual({
      iso: '2026-07-25',
      rest: '维苏威安全文化评估',
    });
  });

  it('parses zero-padded Chinese dates', () => {
    expect(extractLeadingDate('2026年07月25日 维苏威')).toEqual({ iso: '2026-07-25', rest: '维苏威' });
  });

  it('parses hyphen/dot/slash separated dates', () => {
    expect(extractLeadingDate('2026-07-25 周报')).toEqual({ iso: '2026-07-25', rest: '周报' });
    expect(extractLeadingDate('2026/07/25 周报')).toEqual({ iso: '2026-07-25', rest: '周报' });
    expect(extractLeadingDate('2026.7.25 周报')).toEqual({ iso: '2026-07-25', rest: '周报' });
  });

  it('parses 8-digit concatenated dates', () => {
    expect(extractLeadingDate('20260728 维苏威')).toEqual({ iso: '2026-07-28', rest: '维苏威' });
  });

  it('eats a trailing date-range tail like -0731', () => {
    expect(extractLeadingDate('20160730-0731 维苏威安全文化评估：口喷要点')).toEqual({
      iso: '2016-07-30',
      rest: '维苏威安全文化评估：口喷要点',
    });
  });

  it('eats a trailing date-range tail like ~0801', () => {
    expect(extractLeadingDate('2026年07月30日~0801 周报')).toEqual({ iso: '2026-07-30', rest: '周报' });
  });

  it('returns null iso and the original title when there is no leading date', () => {
    expect(extractLeadingDate('我的笔记')).toEqual({ iso: null, rest: '我的笔记' });
  });

  it('falls back to the original title when stripping leaves it empty', () => {
    expect(extractLeadingDate('2026年07月25日')).toEqual({ iso: '2026-07-25', rest: '2026年07月25日' });
  });
});

describe('stripLeadingDate', () => {
  it('strips a leading date and keeps the rest', () => {
    expect(stripLeadingDate('2026年07月25日 维苏威')).toBe('维苏威');
  });

  it('returns the title unchanged when no date is present', () => {
    expect(stripLeadingDate('我的笔记')).toBe('我的笔记');
  });
});

describe('buildNoteBaseName with title-date priority', () => {
  it('uses the title date when present, even if it differs from created_at', () => {
    const note = makeNote({
      title: '2026年7月25日 维苏威安全文化评估',
      created_at: '2026-07-27T22:26:17+08:00',
    });
    expect(buildNoteBaseName(note, makeSettings({ filenamePrefix: 'YYYY年MM月DD日' }))).toBe(
      '2026年07月25日_维苏威安全文化评估',
    );
  });

  it('falls back to created_at when the title has no date', () => {
    const note = makeNote({ title: '我的笔记', created_at: '2026-04-27T22:26:17+08:00' });
    expect(buildNoteBaseName(note, makeSettings({ filenamePrefix: 'YYYY年MM月DD日' }))).toBe(
      '2026年04月27日_我的笔记',
    );
  });

  it('repairs a year typo in the title date via the drift check', () => {
    const note = makeNote({
      title: '20160730-0731 维苏威安全文化评估：口喷要点',
      created_at: '2026-07-27T22:26:17+08:00',
    });
    expect(buildNoteBaseName(note, makeSettings({ filenamePrefix: 'YYYY年MM月DD日' }))).toBe(
      '2026年07月30日_维苏威安全文化评估：口喷要点',
    );
  });
});
