import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TERMINAL_COLOR,
  getTerminalColor,
  setTerminalColor,
  getInterfaceMode,
  setInterfaceMode,
  isValidHexColor,
  getKeepBrowserOpen,
  setKeepBrowserOpen,
  getEntryMeta,
  setEntryMeta,
  deleteEntryMeta,
  getFocusSession,
  setFocusSession,
  getGithubToken,
  setGithubToken,
} from './storage';

describe('terminal color', () => {
  it('defaults when nothing is stored', async () => {
    expect(await getTerminalColor()).toBe(DEFAULT_TERMINAL_COLOR);
  });

  it('round-trips a stored value', async () => {
    await setTerminalColor('#ff8800');
    expect(await getTerminalColor()).toBe('#ff8800');
  });
});

describe('interface mode', () => {
  it('defaults to gui', async () => {
    expect(await getInterfaceMode()).toBe('gui');
  });

  it('round-trips', async () => {
    await setInterfaceMode('tui');
    expect(await getInterfaceMode()).toBe('tui');
  });
});

describe('isValidHexColor', () => {
  it('accepts 3 and 6 digit hex codes', () => {
    expect(isValidHexColor('#fff')).toBe(true);
    expect(isValidHexColor('#ff8800')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isValidHexColor('ff8800')).toBe(false);
    expect(isValidHexColor('#ff88')).toBe(false);
    expect(isValidHexColor('red')).toBe(false);
  });
});

describe('keep browser open', () => {
  it('defaults to true', async () => {
    expect(await getKeepBrowserOpen()).toBe(true);
  });

  it('round-trips false', async () => {
    await setKeepBrowserOpen(false);
    expect(await getKeepBrowserOpen()).toBe(false);
  });
});

describe('entry metadata', () => {
  it('only returns metadata for ids that were actually set', async () => {
    await setEntryMeta({ a: { pinned: true }, b: { pinned: false } });
    const result = await getEntryMeta(['a', 'b', 'c']);
    expect(result).toEqual({ a: { pinned: true }, b: { pinned: false } });
  });

  it('merges instead of overwriting on repeated sets', async () => {
    await setEntryMeta({ a: { pinned: true } });
    await setEntryMeta({ b: { pinned: true } });
    expect(await getEntryMeta(['a', 'b'])).toEqual({ a: { pinned: true }, b: { pinned: true } });
  });

  it('deletes only the requested ids', async () => {
    await setEntryMeta({ a: { pinned: true }, b: { pinned: true } });
    await deleteEntryMeta(['a']);
    expect(await getEntryMeta(['a', 'b'])).toEqual({ b: { pinned: true } });
  });
});

describe('focus session', () => {
  it('is null until one is set', async () => {
    expect(await getFocusSession()).toBeNull();
  });

  it('round-trips and clears', async () => {
    const record = { folderTitle: 'Work', tabIds: [1, 2], endsAt: Date.now() + 1000, alarmName: 'x' };
    await setFocusSession(record);
    expect(await getFocusSession()).toEqual(record);

    await setFocusSession(null);
    expect(await getFocusSession()).toBeNull();
  });
});

describe('github token', () => {
  it('is null until set, and clears when set to null', async () => {
    expect(await getGithubToken()).toBeNull();
    await setGithubToken('ghp_test');
    expect(await getGithubToken()).toBe('ghp_test');
    await setGithubToken(null);
    expect(await getGithubToken()).toBeNull();
  });
});
