import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchSubscribedKnowledgeNotes } from '../src/api';

function mockFetchResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  } as unknown as Response;
}

afterEach(() => {
  vi.mocked(globalThis.fetch).mockRestore();
});

describe('fetchSubscribedKnowledgeNotes topicIds filter (web authMode)', () => {
  it('只对选中的 topic 拉资源,未选中的 topic URL 从未请求', async () => {
    const calls: string[] = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      calls.push(url);
      if (url.includes('/v1/web/subscribe/topic/list')) {
        return mockFetchResponse({
          h: {},
          c: {
            list: [
              { id_alias: 'wanted', id: 'wanted', name: 'Wanted Topic', root_dir: { id: 'dir-w' } },
              { id_alias: 'skipped', id: 'skipped', name: 'Skipped Topic', root_dir: { id: 'dir-s' } },
            ],
          },
        });
      }
      if (url.includes('topic_id_alias=wanted')) {
        return mockFetchResponse({ h: {}, c: { resources: [], has_next: false } });
      }
      return mockFetchResponse({ h: {}, c: { resources: [], has_next: false } });
    });

    const notes = await fetchSubscribedKnowledgeNotes({
      token: 'tok',
      clientId: '',
      authMode: 'web',
      topicIds: ['wanted'],
    });

    expect(notes).toEqual([]);
    expect(calls.some(u => u.includes('topic_id_alias=wanted'))).toBe(true);
    expect(calls.some(u => u.includes('topic_id_alias=skipped'))).toBe(false);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('topicIds=[] 时返回空集,不静默回退全量', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      calls.push(url);
      if (url.includes('/v1/web/subscribe/topic/list')) {
        return mockFetchResponse({
          h: {},
          c: {
            list: [
              { id_alias: 'a', id: 'a', name: 'A', root_dir: { id: 'd1' } },
              { id_alias: 'b', id: 'b', name: 'B', root_dir: { id: 'd2' } },
            ],
          },
        });
      }
      return mockFetchResponse({ h: {}, c: { resources: [], has_next: false } });
    });

    const notes = await fetchSubscribedKnowledgeNotes({
      token: 'tok',
      clientId: '',
      authMode: 'web',
      topicIds: [],
    });

    expect(notes).toEqual([]);
    expect(calls.some(u => u.includes('topic_id_alias=a'))).toBe(false);
    expect(calls.some(u => u.includes('topic_id_alias=b'))).toBe(false);
  });

  it('不传 topicIds 时维持旧行为:遍历所有订阅 topic', async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      calls.push(url);
      if (url.includes('/v1/web/subscribe/topic/list')) {
        return mockFetchResponse({
          h: {},
          c: {
            list: [
              { id_alias: 'a', id: 'a', name: 'A', root_dir: { id: 'd1' } },
              { id_alias: 'b', id: 'b', name: 'B', root_dir: { id: 'd2' } },
            ],
          },
        });
      }
      return mockFetchResponse({ h: {}, c: { resources: [], has_next: false } });
    });

    await fetchSubscribedKnowledgeNotes({
      token: 'tok',
      clientId: '',
      authMode: 'web',
    });

    expect(calls.some(u => u.includes('topic_id_alias=a'))).toBe(true);
    expect(calls.some(u => u.includes('topic_id_alias=b'))).toBe(true);
  });
});

describe('fetchSubscribedKnowledgeNotes 单库失败隔离 (web authMode)', () => {
  it('某个知识库拉取失败时回调 onTopicError,且其余库的笔记仍正常返回', async () => {
    const failedTopics: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.includes('/v1/web/subscribe/topic/list')) {
        return mockFetchResponse({
          h: {},
          c: {
            list: [
              { id_alias: 'good', id: 'good', name: 'Good Topic', root_dir: { id: 'd1' } },
              { id_alias: 'bad', id: 'bad', name: 'Bad Topic', root_dir: { id: 'd2' } },
            ],
          },
        });
      }
      if (url.includes('topic_id_alias=bad')) {
        throw new Error('openApiNotMember: 无权访问该知识库');
      }
      if (url.includes('topic_id_alias=good')) {
        return mockFetchResponse({
          h: {},
          c: {
            resources: [
              { resource_note_meta_data: { note_id: 'n1', title: 'Note 1' }, resource_type: '0' },
            ],
            has_next: false,
          },
        });
      }
      return mockFetchResponse({ h: {}, c: { resources: [], has_next: false } });
    });

    const notes = await fetchSubscribedKnowledgeNotes({
      token: 'tok',
      clientId: '',
      authMode: 'web',
      onTopicError: (topic) => failedTopics.push(topic.topic_id),
    });

    // 失败的库被上报,且函数不会中断
    expect(failedTopics).toEqual(['bad']);
    // 其余库的笔记仍然返回
    expect(notes.map(n => n.note_id)).toContain('n1');
  });
});
