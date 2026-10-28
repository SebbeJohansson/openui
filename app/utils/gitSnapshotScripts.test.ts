import { describe, expect, it } from 'vitest';
import {
  buildWorktreeSnapshotScript,
  parseCommitSnapshotOutput,
  parseFileSnapshotOutput,
} from './gitSnapshotScripts';

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');

describe('parseCommitSnapshotOutput', () => {
  it('decodes framed before/after blobs per file and tolerates CRLF', () => {
    const raw = [
      '##TITLE\tabc123 Fix things',
      '##FILE\tM\tsrc/a.ts',
      '##BEFORE',
      b64('old'),
      '##AFTER',
      b64('new'),
      '##FILE\tA\tsrc/b.ts',
      '##BEFORE',
      '##AFTER',
      b64('added'),
      '',
    ].join('\r\n');
    const result = parseCommitSnapshotOutput(raw);
    expect(result.title).toBe('abc123 Fix things');
    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toMatchObject({
      status: 'M',
      file: 'src/a.ts',
      before: 'old',
      after: 'new',
    });
    expect(result.files[1]).toMatchObject({
      status: 'A',
      file: 'src/b.ts',
      before: '',
      after: 'added',
    });
  });

  it('ignores content before the first file header', () => {
    expect(parseCommitSnapshotOutput('garbage\n##TITLE\tx\n').files).toEqual([]);
  });
});

describe('parseFileSnapshotOutput', () => {
  it('joins wrapped base64 lines', () => {
    const encoded = b64('hello world');
    const raw = `##BEFORE\n${encoded.slice(0, 4)}\n${encoded.slice(4)}\n##AFTER\n${b64('bye')}\n`;
    expect(parseFileSnapshotOutput(raw)).toMatchObject({ before: 'hello world', after: 'bye' });
  });
});

describe('buildWorktreeSnapshotScript', () => {
  it('produces a shell script whose title reflects the mode', () => {
    expect(buildWorktreeSnapshotScript('staged')).toContain('Staged changes');
    expect(buildWorktreeSnapshotScript('changes')).toContain('Unstaged changes');
    expect(buildWorktreeSnapshotScript('all')).toContain('git ');
  });
});
