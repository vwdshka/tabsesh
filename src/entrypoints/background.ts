import { getOrCreateRootFolder, endFocusSession } from '../lib/core/bookmarks';

// chrome global is real inside the injected page context below, unlike the rest of this
// project which uses the browser polyfill - declared narrowly to skip pulling in @types/chrome
declare const chrome: { runtime: { getURL(path: string): string } };

// runs inside the target page via scripting.executeScript, so it has to be self-contained -
// no closures over anything outside its own body
function toggleOverlay() {
  const HOST_ID = 'tabsesh-overlay-host';
  const existing = document.getElementById(HOST_ID);
  if (existing) {
    existing.remove();
    return;
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = [
    'position: fixed',
    'inset: 0',
    'z-index: 2147483647',
    'display: flex',
    'align-items: center',
    'justify-content: center',
    'background: rgba(10, 10, 12, 0.55)',
  ].join(';');

  const frame = document.createElement('iframe');
  frame.src = chrome.runtime.getURL('/overlay.html');
  frame.style.cssText = [
    'width: min(720px, 92vw)',
    'height: min(480px, 80vh)',
    'border: none',
    'border-radius: 14px',
    'box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5)',
    'background: transparent',
  ].join(';');

  function handleMessage(event: MessageEvent) {
    if (event.data && event.data.type === 'tabsesh-overlay-close') {
      host.remove();
      window.removeEventListener('message', handleMessage);
    }
  }

  host.addEventListener('mousedown', (e) => {
    if (e.target === host) host.remove();
  });
  window.addEventListener('message', handleMessage);

  host.appendChild(frame);
  document.documentElement.appendChild(host);
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void getOrCreateRootFolder();
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-overlay') return;

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      await browser.scripting.executeScript({ target: { tabId: tab.id }, func: toggleOverlay });
    } catch {
      // chrome://, the Web Store etc. can't be injected into - nothing to do
    }
  });

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (!alarm.name.startsWith('tabsesh-focus-session:')) return;

    const status = await endFocusSession(alarm.name);
    if (!status) return;

    try {
      await browser.notifications.create({
        type: 'basic',
        iconUrl: browser.runtime.getURL('/icon/128.png'),
        title: 'Focus session ended',
        message: `"${status.folderTitle}" has been re-stashed and closed.`,
      });
    } catch {
      // notifications can be blocked at the OS level, but the re-stash already happened
    }
  });
});
