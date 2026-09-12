import { describe, expect, it } from 'vitest';
import { getFaviconUrl } from './favicon';

describe('getFaviconUrl', () => {
  it('builds a _favicon resource url with the page url and default size', () => {
    const url = getFaviconUrl('https://example.com/page');
    const parsed = new URL(url);

    expect(parsed.pathname).toBe('/_favicon/');
    expect(parsed.searchParams.get('pageUrl')).toBe('https://example.com/page');
    expect(parsed.searchParams.get('size')).toBe('32');
  });

  it('respects a custom size', () => {
    const url = getFaviconUrl('https://example.com', 64);
    expect(new URL(url).searchParams.get('size')).toBe('64');
  });
});
