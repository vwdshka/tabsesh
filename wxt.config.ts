import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'TabSesh',
    description: 'Lightning-fast, keyboard-first session stashing for your tabs.',
    permissions: [
      'tabs',
      'tabGroups',
      'bookmarks',
      'storage',
      'scripting',
      'processes',
      'favicon',
      'alarms',
      'notifications',
    ],
    host_permissions: ['<all_urls>'],
    commands: {
      'toggle-overlay': {
        suggested_key: {
          default: 'Ctrl+Shift+Space',
          mac: 'Command+Shift+Space',
        },
        description: 'Toggle the TabSesh quick overlay on the current page',
      },
    },
  },
});
