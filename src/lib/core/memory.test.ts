import { describe, expect, it } from 'vitest';
import { formatBytes } from './memory';

describe('formatBytes', () => {
  it('formats bytes under 1024 as-is', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('formats kilobytes', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
  });

  it('formats megabytes', () => {
    expect(formatBytes(742 * 1024 * 1024)).toBe('742 MB');
  });

  it('formats gigabytes', () => {
    expect(formatBytes(1.3 * 1024 * 1024 * 1024)).toBe('1.3 GB');
  });
});
