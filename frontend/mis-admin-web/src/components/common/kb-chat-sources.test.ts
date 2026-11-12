// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  extractKbSourcesFromA2uiNodes,
  isStaticKbSourceStub,
  mergeKbSources,
  parseStaticKbSourceStub,
  splitKbSources,
} from './kb-chat-sources';

describe('splitKbSources', () => {
  it('剥标准 kb-sources 围栏并保留正文', () => {
    const content = [
      'Pad 退货需开启退货开关。',
      '',
      '```kb-sources',
      '[{"source":"Pad售后手册","score":0.91,"chunk":"退货开关：开启","page":3}]',
      '```',
    ].join('\n');
    const { body, sources } = splitKbSources(content);
    expect(body).toBe('Pad 退货需开启退货开关。');
    expect(sources).toEqual([
      {
        source: 'Pad售后手册',
        score: 0.91,
        chunk: '退货开关：开启',
        page: 3,
        offset: null,
        libraryId: null,
        documentId: null,
        imageId: undefined,
        index: null,
      },
    ]);
  });

  it('兼容 info 行带空格（``` kb-sources）——避免原文落入 Markdown', () => {
    const content = '答案正文\n\n``` kb-sources\n[{"source":"手册","score":0.8}]\n```';
    const { body, sources } = splitKbSources(content);
    expect(body).toBe('答案正文');
    expect(body).not.toContain('kb-sources');
    expect(sources[0]?.source).toBe('手册');
  });

  it('兼容闭合前无换行', () => {
    const content = '答案\n\n```kb-sources\n[{"source":"a"}]```';
    const { body, sources } = splitKbSources(content);
    expect(body).toBe('答案');
    expect(sources[0]?.source).toBe('a');
  });

  it('流式未闭合围栏时隐藏 JSON', () => {
    const content = '答案正文\n\n```kb-sources\n[{"source":';
    const { body, sources } = splitKbSources(content);
    expect(body).toBe('答案正文');
    expect(sources).toEqual([]);
    expect(body).not.toContain('kb-sources');
  });

  it('解析 legacy 来源列表', () => {
    const content = '根据手册领取工牌。\n\n来源：\n1. 员工手册（相关度 0.91）\n2. 文档 13\n';
    const { body, sources } = splitKbSources(content);
    expect(body).toBe('根据手册领取工牌。');
    expect(sources[0]).toEqual({ source: '员工手册', score: 0.91 });
    expect(sources[1]).toEqual({ source: '文档 13', score: null });
  });

  it('无来源时原样返回', () => {
    const { body, sources } = splitKbSources('未命中');
    expect(body).toBe('未命中');
    expect(sources).toEqual([]);
  });

  it('字面 \\n 还原后可剥围栏', () => {
    const content =
      '# Pad退货\\n\\n开启退货开关。\\n\\n```kb-sources\\n[{"source":"手册","score":0.9}]\\n```';
    const { body, sources } = splitKbSources(content);
    expect(body).toContain('# Pad退货');
    expect(body).not.toContain('kb-sources');
    expect(sources[0]?.source).toBe('手册');
  });

  it('无围栏但末尾是带 source 的 JSON 数组', () => {
    const content = '结论如下。\n[{"source":"手册A","score":0.7}]';
    const { body, sources } = splitKbSources(content);
    expect(body).toBe('结论如下。');
    expect(sources[0]?.source).toBe('手册A');
  });

  it('多段围栏时优先选用带 chunk 的一段', () => {
    const content = [
      '答案',
      '',
      '```kb-sources',
      '[{"source":"手册","score":0.9}]',
      '```',
      '',
      '```kb-sources',
      '[{"source":"手册","score":0.9,"chunk":"退货开关：开启"}]',
      '```',
    ].join('\n');
    const { body, sources } = splitKbSources(content);
    expect(body).toBe('答案');
    expect(sources[0]?.chunk).toBe('退货开关：开启');
  });
});

describe('mergeKbSources', () => {
  it('后到的无 chunk 条目不得覆盖已有片段', () => {
    const merged = mergeKbSources(
      [{ source: '手册', score: 0.9, chunk: '退货开关：开启' }],
      [{ source: '手册', score: 0.95, chunk: undefined, page: 3 }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.chunk).toBe('退货开关：开启');
    expect(merged[0]?.score).toBe(0.95);
    expect(merged[0]?.page).toBe(3);
  });
});

describe('静态条款来源 stub', () => {
  it('识别并解析「来源文档」文案', () => {
    const text = '📚 条款来源\n来源文档: PAD问题集-知识库版.docx';
    expect(isStaticKbSourceStub(text)).toBe(true);
    const sources = parseStaticKbSourceStub(text);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.source).toBe('PAD问题集-知识库版.docx');
  });

  it('从 A2UI 树抽取静态来源', () => {
    const nodes = [
      {
        component: 'container',
        props: {},
        children: [
          { component: 'text', props: { content: '1️⃣ 申请退款权限' } },
          {
            component: 'text',
            props: { content: '📚 条款来源\n来源文档: PAD问题集-知识库版.docx' },
          },
        ],
      },
    ];
    const sources = extractKbSourcesFromA2uiNodes(nodes);
    expect(sources[0]?.source).toBe('PAD问题集-知识库版.docx');
  });
});
