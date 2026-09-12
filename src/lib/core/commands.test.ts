import { fakeBrowser } from '@webext-core/fake-browser';
import { describe, expect, it } from 'vitest';
import { runCommand } from './commands';

async function createTab(url: string) {
  return fakeBrowser.tabs.create({ url, active: false });
}

describe('runCommand', () => {
  it('returns nothing for an empty line', async () => {
    expect(await runCommand('   ')).toEqual({ lines: [] });
  });

  it('reports an unknown command', async () => {
    const result = await runCommand('nonsense');
    expect(result.lines[0]?.text).toMatch(/Unknown command/);
  });

  it('clear signals the terminal to wipe its scrollback', async () => {
    const result = await runCommand('clear');
    expect(result.clear).toBe(true);
  });

  it('help lists the command set', async () => {
    const result = await runCommand('help');
    expect(result.lines.some((l) => l.text.includes('stash'))).toBe(true);
  });

  it('honors quoted phrases as single tokens for two-argument commands', async () => {
    await createTab('https://a.example');
    await runCommand('stash "Old Name"');

    const renamed = await runCommand('rename "Old Name" "New Name"');
    expect(renamed.lines[0]?.text).toContain('Renamed "Old Name" to "New Name"');
  });

  it('mkdir then move works with quoted, space-containing folder names', async () => {
    await createTab('https://a.example');
    await runCommand('stash "Client work"');
    await runCommand('mkdir Projects');

    const moved = await runCommand('move "Client work" Projects');
    expect(moved.lines[0]?.text).toContain('Moved "Client work" into "Projects"');
  });

  it('color validates hex input before storing it', async () => {
    const bad = await runCommand('color not-a-color');
    expect(bad.lines[0]?.text).toMatch(/not a valid hex color/);
    expect(bad.colorChange).toBeUndefined();

    const good = await runCommand('color #336699');
    expect(good.colorChange).toBe('#336699');
  });

  it('keep-open reports and toggles state', async () => {
    const status = await runCommand('keep-open');
    expect(status.lines[0]?.text).toMatch(/on/);

    const off = await runCommand('keep-open off');
    expect(off.lines[0]?.text).toMatch(/off/);

    const invalid = await runCommand('keep-open sideways');
    expect(invalid.lines[0]?.text).toMatch(/Usage/);
  });

  it('find without a query shows usage instead of throwing', async () => {
    const result = await runCommand('find');
    expect(result.lines[0]?.text).toMatch(/Usage/);
  });

  it('find defaults to "all" mode when the first word is not a real mode', async () => {
    await createTab('https://findable.example');
    await runCommand('stash Notes');

    const result = await runCommand('find findable');
    expect(result.lines[0]?.text).toMatch(/1 match/);
  });

  it('rm reports a folder was moved to trash, and undo brings it back', async () => {
    await createTab('https://a.example');
    await runCommand('stash Temp');

    const removed = await runCommand('rm Temp');
    expect(removed.lines[0]?.text).toContain('Deleted "Temp"');

    const undone = await runCommand('undo');
    expect(undone.lines[0]?.text).toContain('Restored "Temp"');
  });

  it('surfaces a thrown error as an Error: line instead of rejecting', async () => {
    const result = await runCommand('rename "Does Not Exist" "Whatever"');
    expect(result.lines[0]?.text).toMatch(/^Error: /);
  });
});
