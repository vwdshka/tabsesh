import { exportFolder } from './bookmarks';
import { getGithubToken } from './storage';

// pre-fills scope + description so the token comes back with exactly the gist permission
export const GITHUB_TOKEN_SETUP_URL =
  'https://github.com/settings/tokens/new?scopes=gist&description=TabSesh%20sharing';

// the only network request in the whole extension - fires only when the user clicks Share,
// using a token they supplied themselves
export async function shareFolder(folderName: string): Promise<string> {
  const token = await getGithubToken();
  if (!token) {
    throw new Error('Set a GitHub token first (Share settings) to publish a folder as a Gist.');
  }

  const result = await exportFolder(folderName);
  if (result.urls.length === 0) {
    throw new Error(`"${folderName}" has no saved tabs to share.`);
  }

  const response = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      description: `TabSesh: ${result.folderTitle}`,
      public: true,
      files: {
        [`${result.folderTitle.replace(/[^a-z0-9 _-]/gi, '') || 'tabsesh-folder'}.md`]: {
          content: `# ${result.folderTitle}\n\n${result.markdown}\n`,
        },
      },
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('That GitHub token was rejected — check it still has the "gist" scope and hasn\'t expired.');
    }
    throw new Error(`GitHub rejected the share (HTTP ${response.status}).`);
  }

  const data = (await response.json()) as { html_url?: string };
  if (!data.html_url) {
    throw new Error('GitHub did not return a link for the new Gist.');
  }
  return data.html_url;
}
