import mri from 'mri';
import {
  stashAllWindows,
  listSessions,
  createCategory,
  renameFolder,
  moveFolder,
  removeFolder,
  exportFolder,
  restoreFolder,
  clearAll,
  listTrash,
  restoreFromTrash,
  undoLastDelete,
  parseEntryTitle,
  searchStash,
  startFocusSession,
  cancelFocusSession,
  getFocusSessionStatus,
} from './bookmarks';
import { formatBytes } from './memory';
import { shareFolder } from './share';
import {
  getTerminalColor,
  setTerminalColor,
  isValidHexColor,
  getKeepBrowserOpen,
  setKeepBrowserOpen,
} from './storage';
import type { SearchMode, SessionFolder } from './types';

// url set = renders as a clickable link
export interface OutputLine {
  text: string;
  url?: string;
}

export interface CommandOutput {
  lines: OutputLine[];
  colorChange?: string;
  clear?: boolean;
}

// keeps "quoted phrases" as one token - default stash folder names are timestamps
// with a space in them, so two-argument commands like rename/move need this to
// tell where one name ends and the next starts
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input))) {
    tokens.push(match[1] !== undefined ? match[1] : match[2]!);
  }
  return tokens;
}

const text = (s: string): OutputLine => ({ text: s });
const plain = (lines: string[]): OutputLine[] => lines.map(text);
const link = (label: string, url: string): OutputLine => ({ text: label, url });

// history/snake are handled inside Terminal.svelte itself, not here - still listed
// so the syntax highlighter and help text agree on what's valid
export const COMMAND_NAMES = [
  'stash',
  'list',
  'open',
  'restore',
  'copy',
  'mkdir',
  'rename',
  'move',
  'rm',
  'trash',
  'undo',
  'focus',
  'share',
  'find',
  'color',
  'keep-open',
  'clear',
  'clear-all',
  'history',
  'snake',
  'dvd',
  'berserk',
  'samurai',
  'whoami',
  'tip',
  'help',
] as const;

function renderTree(folder: SessionFolder, depth = 0): OutputLine[] {
  const indent = '  '.repeat(depth);
  const lines: OutputLine[] = depth === 0 ? [] : [text(`${indent}📁 ${folder.title}`)];

  for (const entry of folder.entries) {
    const { timestamp, label } = parseEntryTitle(entry.title);
    lines.push(link(`${indent}  • ${label}${timestamp ? `  (${timestamp})` : ''}`, entry.url));
  }
  for (const child of folder.children) {
    lines.push(...renderTree(child, depth + 1));
  }
  return lines;
}

const HELP_TEXT = [
  'Available commands:',
  '  stash [category]           Save & close every open tab (all windows)',
  '  list                       Show saved folders and categories (links are clickable)',
  '  open [folder]              List a folder\'s tabs as clickable links',
  '  restore [folder]           Reopen a folder as a real window — tab groups & pins included',
  '  copy [folder]              Copy a folder\'s URLs to the clipboard',
  '  mkdir [category]           Create a new organizational category',
  '  rename [folder] [new_name] Rename a folder. Quote names with spaces: rename "2026-09-12 01:33:36" "Client work"',
  '  move [folder] [category]   Move a saved folder into a category',
  '  rm [folder]                Delete a folder (goes to trash for 48h — type "undo" to bring it back)',
  '  trash                      List everything sitting in trash and when it\'ll be gone for good',
  '  undo [folder]              Undo the last delete, or restore a specific folder from trash by name',
  '  focus [folder] [minutes]   Restore a folder for a set time, then auto re-stash & close it',
  '  focus cancel               Cancel the running focus session (leaves the tabs open)',
  '  share [folder]             Publish a folder as a public GitHub Gist link (needs a token — set one from the GUI)',
  '  find [category|link|date] [query]   Search everything you\'ve stashed',
  '  color [#hex]                Set the terminal accent color, or show the current one',
  '  keep-open [on|off]         Leave a new tab open instead of closing the browser on stash',
  '  clear                      Clear the terminal screen',
  '  clear-all                  Trash everything in TabSesh (also undoable within 48h)',
  '  history                    Show your previously typed commands',
  '  snake                      ...you found it. Arrow keys to play, Esc to quit.',
  '  dvd                        A bouncing-logo screensaver. Esc to quit.',
  '  help                       Show this message',
];

const SEARCH_MODES: SearchMode[] = ['all', 'category', 'link', 'date'];

const BERSERK_ART = `⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣸⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⠆⠀⠀⠀⠀⠀⠀⠀⢹⣦⣼⣿⣿⣴⣾⠃⠀⠀⠀⠀⠀⠀⣆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣾⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⢿⣿⣿⣿⣿⠃⠀⠀⠀⠀⠀⠀⠀⠘⢷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣾⡿⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⣿⣿⣿⡟⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢻⣿⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⡟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠰⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠹⣿⣿⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⣿⠏⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⢿⣿⣿⣦⡀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⣀⣴⣿⣿⣿⡿⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢻⣿⣿⣿⣶⣄⠀⠀⠀⠀⠀
⠀⠀⣠⣾⣿⣿⣿⣿⡟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠹⣿⣿⣿⣿⣷⣄⠀⠀⠀
⠀⠀⠛⢿⣿⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣿⣿⣿⣿⣿⡿⠃⠀⠀
⠀⠀⠀⠀⠙⢿⣿⣿⣿⣿⣷⣄⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣾⣿⣿⣿⣿⡿⠋⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠈⠻⣿⣿⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣴⣿⣿⣿⣿⣿⠟⠁⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠈⠻⣿⣿⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠠⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣾⣿⣿⣿⣿⡿⠋⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⢿⣿⣿⣿⣿⣷⣤⡀⠀⠀⠀⠀⠀⠀⢰⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⢀⣠⣾⣿⣿⣿⣿⡿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⢿⣿⣿⣿⣿⣿⣦⡀⠀⠀⠀⠀⠨⣿⣿⣿⡇⠀⠀⠀⠀⢀⣴⣿⣿⣿⣿⣿⠿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⢿⣿⣿⣿⣿⣿⣦⣀⠀⠀⢸⣿⣿⣿⡇⠀⠀⢀⣴⣿⣿⣿⣿⣿⠟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠿⣿⣿⣿⣿⣿⣷⣄⢸⣿⣿⣿⣇⣠⣶⣿⣿⣿⣿⣿⠟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢈⣿⣿⣿⣿⣿⣿⣿⣿⣿⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣾⣿⣿⣿⣿⣿⣿⡿⠟⣿⣿⣿⡿⠿⣿⣿⣿⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣾⣿⣿⣿⣿⣿⣿⡿⠋⠀⠀⣿⣿⣿⣿⠀⠈⠻⣿⣿⣿⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣾⣿⣿⣿⣿⣿⣿⠟⠉⠀⠀⠀⢘⣿⣿⣿⡏⠀⠀⠀⠈⠻⣿⣿⣿⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⣿⣿⣿⣿⣿⠟⠁⠀⠀⠀⠀⠀⢨⣿⣿⣿⣏⠀⠀⠀⠀⠀⠀⠙⢿⣿⣿⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⣿⣿⣿⣿⡿⠋⠁⠀⠀⠀⠀⠀⠀⠀⠘⣿⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠙⢿⣿⣿⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⣠⣶⣿⣿⣿⣿⣿⣿⡿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢰⣿⣿⣿⡯⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⠿⣿⣿⣿⣿⣿⣷⣦⠀⠀⠀⠀⠀⠀
⠀⠀⠀⣠⣾⣿⣿⣿⣿⣿⣿⠟⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠻⣿⣿⣿⣿⣿⣿⣦⡀⠀⠀⠀
⠀⣠⣾⣿⣿⣿⣿⣿⡿⠟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣷⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠻⣿⣿⣿⣿⣿⣿⣦⡀⠀
⠺⣿⣿⣿⣿⣿⣿⣿⡁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⣿⣿⣿⡿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣼⣿⣿⣿⣿⣿⣿⡿⠂
⠀⠈⠻⣿⣿⣿⣿⣿⣿⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢘⣿⣿⣿⡟⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣿⣿⣿⣿⣿⣿⡿⠋⠀⠀
⠀⠀⠀⠈⠻⣿⣿⣿⣿⣿⣿⣦⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣾⣿⣿⣿⣿⣿⣿⠏⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠙⢿⣿⣿⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣷⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⣿⣿⣿⣿⡿⠋⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠙⢿⣿⣿⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⣰⣿⣿⣿⣿⣿⣿⡿⠋⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⢿⣿⣿⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⠀⠰⣿⣿⣿⡟⠀⠀⠀⠀⠀⠀⠀⣠⣾⣿⣿⣿⣿⣿⡿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⢿⣿⣿⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⢸⣿⣿⣿⣇⠀⠀⠀⠀⠀⣠⣾⣿⣿⣿⣿⣿⡿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⢿⣿⣿⣿⣿⣿⣷⣄⠀⠀⠀⢸⣿⣿⣿⣟⠀⠀⠀⢠⣾⣿⣿⣿⣿⣿⣿⠟⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⢿⣿⣿⣿⣿⣿⣷⣄⠀⢸⣿⣿⣿⣿⠀⢀⣴⣿⣿⣿⣿⣿⣿⠟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⢿⣿⣿⣿⣿⣿⣷⣴⣿⣿⣿⣷⣴⣿⣿⣿⣿⣿⣿⠟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⢿⣿⣿⣿⣿⣿⣿⣿⡿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⢿⣿⣿⡿⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀`;

const SAMURAI_ART = `⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⣤⡄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⠿⠓⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣰⣿⣿⡟⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣰⠃⠀⠀⠀⠀⠀⠀⠀⠀⣸⣿⣿⡟⠀⢀⡆⠀⠀⠀⠀⠀⠀⢀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡼⠀⠅⠀⠀⠀⠀⢀⡄⠀⠀⠀⣿⣿⣿⣗⣠⣾⡇⠀⠀⠀⠀⢠⠆⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⡇⠀⠀⠀⠀⠀⠀⢸⣆⠀⠀⢰⣿⣿⣿⣿⣿⣯⠀⢀⣴⠆⠀⠻⠂⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⡼⣷⠀⠀⠀⠀⠀⠀⢸⣿⠀⢀⣾⣿⣿⣿⣿⣿⡿⣥⣾⡟⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢻⣿⡆⠀⠀⣀⣴⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠏⢹⣿⠀⠀⠀⣴⠃⠀⣠⡆⢀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠱⣄⠀⠀⠀⠀⠈⣿⡇⠀⢰⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠃⠀⠘⠁⠀⠀⣰⣿⠀⢰⠟⠀⣤⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣿⠀⠀⠙⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠀⢀⠁⠀⢀⣰⣿⣿⡿⠆⠈⠀⣰⣷⡄⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠘⢿⣦⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⡾⣧⡜⠀⣠⣿⣿⣿⣿⡿⠋⣹⣿⣿⣿⠟⢸⣿⣦⣴⣿⣿⣿⡿⠁⠀⠀⣾⣿⣿⠁⠀⠀⠀⠀
⠀⠀⠀⠀⢀⠀⠀⢹⣿⣧⠀⠀⠀⠀⡀⢀⣾⢀⣿⣿⣿⣾⣿⣿⣿⣿⠛⠁⢠⠿⠟⠉⠁⠀⢸⣹⣿⣿⠛⠻⣯⠁⠀⠀⣀⣿⠿⠁⠀⠀⠀⣆⢹
⠀⠀⠰⣄⠸⣷⡄⠀⢿⣟⠀⠀⠀⠀⣷⡀⣇⠀⣿⣿⠿⣿⠛⣿⠏⠀⠀⡄⠀⢀⣴⡾⠁⠀⣼⣿⡿⠏⠀⠐⣿⡄⠀⣰⠋⠀⠀⣺⠀⠀⠀⢹⣘
⠀⠀⠠⣽⣶⡿⠇⠀⠀⢉⠀⠶⠒⠀⠘⢷⣿⣥⠈⠿⠀⠘⢆⠘⠀⢠⣿⡁⠀⣾⣿⠃⠀⣸⢿⣿⣇⣀⠀⢀⣿⡇⠀⡘⠀⠀⠸⣿⠀⠀⠀⢸⠁
⠀⠀⠀⠘⠋⢀⠀⣄⠀⣆⠁⣾⣿⣧⠀⠘⣿⣿⣦⢸⣦⠀⠈⣤⣼⣿⣿⣿⣾⡿⠁⠀⠈⣠⣾⣿⣿⣿⣿⣿⣿⡇⢀⣧⠀⠲⣀⣿⡆⠀⠐⠀⠀
⠀⠀⠀⠀⡶⢠⣾⡿⠷⠿⢷⣿⣿⣿⠇⠀⠋⢹⣿⣶⣿⣷⣶⣿⣿⣿⠋⠉⣿⠃⠀⢀⣾⣿⣿⣿⣿⡿⠻⠙⠿⡇⠈⣿⠁⠀⣿⠏⠀⠀⠀⠀⠀
⠀⠀⠀⠀⡀⠙⡁⠶⣿⡿⢒⣠⠀⡤⠀⢐⠀⠸⣿⣿⣿⣿⣿⡟⠉⢿⠀⢸⣿⡀⠀⢸⣿⣿⣿⠟⠁⠀⠀⠀⠀⢱⠀⠎⠠⠔⠁⠀⠀⠀⠀⠀⠀
⠀⠀⣶⠀⡇⢄⠘⠲⣦⠰⠟⠉⠒⠲⡄⠀⠁⢸⣿⠟⠁⢸⠟⢣⠀⠻⡀⠘⢿⣿⣿⣿⣿⣿⠏⠀⠀⠀⠀⠀⠀⠘⡆⠀⣶⠃⣰⡆⠀⠀⠀⠀⠀
⠂⠀⣿⣦⠈⠈⠛⢶⣦⠀⡸⡀⠀⠀⡸⠀⠀⠈⠁⠀⠰⠃⠀⢸⣄⠀⠘⠂⡀⢻⣿⡿⠟⠀⢤⠀⠀⠀⠀⠀⠀⢰⠗⢠⡯⢰⣿⠁⠀⠀⠀⠀⠀
⠀⣼⣿⡿⠁⠀⠈⢀⣄⠀⠷⣬⣑⡨⣴⡇⣴⠀⢀⣄⣠⣤⣴⣿⣾⣷⢄⡀⠀⠈⠀⠀⠈⠓⠋⠀⠀⠀⠀⢀⣼⠏⠀⣸⡇⢨⡏⠀⠀⠀⠀⠀⠀
⠀⢫⣿⡃⠀⢰⣿⣦⣅⡀⠛⠶⠶⠶⠌⠁⠀⠀⠀⠀⠉⠉⣿⣹⣿⠉⠙⣌⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣤⡞⠁⠀⣰⢫⡇⠈⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠈⠇⠘⠘⢿⣥⣀⠉⠛⣿⣷⣶⣿⣿⡟⢀⣴⠂⠀⠀⠀⠹⣿⣧⡀⠀⠙⢦⡀⠀⠀⢦⣄⣤⣨⣭⣤⣠⠴⠋⠀⠸⠁⠀⢦⡀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⣬⣙⡛⠓⠒⢒⢀⣤⠀⣄⠻⣿⣄⠀⠀⠀⢀⣿⣿⣽⣦⡀⠀⠀⠳⣄⡀⠀⠈⠛⠛⠛⠁⠀⡠⠞⠁⠀⠻⣦⡹⣦⡐⢄⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠉⠉⠉⣻⠟⣛⣃⣸⣿⡇⣹⣿⡷⠀⣠⠟⢻⣿⢿⠛⠋⠃⡄⠀⠈⢿⣶⣶⠦⢶⡖⠆⢁⣄⠐⢿⣷⣄⠈⠻⣌⢻⣆⠡⡀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⢋⣼⣿⣿⡿⠙⢁⣾⣿⡇⠀⠀⣠⣾⣿⠀⠀⠀⣴⠃⠀⣀⣀⡈⠉⠛⢷⣾⠀⠻⣿⣷⣄⠙⠛⣡⣄⡹⣧⠹⡇⢱
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⠘⠗⣠⣌⠛⠀⠹⠿⠿⣇⠀⠀⠻⠿⠋⠀⠀⠋⠁⡔⠚⠉⣉⡋⠐⠀⠀⢟⠀⠀⠈⠻⣿⠇⣀⠈⠛⢛⣿⡗⢃⡌
⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣾⢛⣴⣿⣿⣧⠰⣷⢰⡆⣶⢠⠀⠰⣦⣤⣤⣴⠶⠉⠀⢰⣾⣿⣿⣦⠈⠀⠀⠀⠀⠀⠀⠨⡘⢿⣿⣿⣿⣿⠇⡼⠀
⠀⠀⠀⠀⢀⣀⣤⠶⢟⣫⣴⣿⣿⣿⣿⠏⠰⣤⡤⠔⠀⠀⠀⠀⠉⠉⠉⠁⠀⠀⠀⠈⠻⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⠈⠒⠦⠭⠭⠥⠚⠀⠀
⠀⠀⠴⠞⣛⣭⣴⣾⣿⣿⣿⣿⠿⠛⣡⢸⣷⣌⠓⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠠⠀⣦⠐⣌⠻⢿⣿⣿⣷⣦⣬⣓⡒⠤⠤⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠤⣭⣭⣭⣭⣭⣭⣭⣭⠐⢶⡃⠉⠘⠿⠿⠈⡁⣠⣾⣿⣿⢿⣷⣶⣄⡙⠂⢾⣿⠀⠟⣡⣤⣍⡛⠻⢿⣿⣿⣿⡿⠶⢒⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠈⠉⠁⠀⠀⠀⠀⠈⢿⣤⣀⣀⣦⠿⠛⠉⢁⡀⠀⢀⣀⡀⠙⠹⠿⣷⣦⣤⣞⣿⣿⠟⠀⠘⠓⠲⠶⠶⠒⠋⠁⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠓⠋⣡⡴⢁⣴⣿⣿⣦⣶⣿⣷⣄⠀⢶⣤⣭⠍⠛⠛⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢁⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⠄⠛⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠛⠿⠿⠟⠻⠿⠿⠟⠋⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀`;

const TIPS = [
  'Tabs are like tribbles — they multiply when you\'re not looking. Stash early, stash often.',
  '`find date 2026` finds every tab you stashed this year in one line.',
  'You can rename how you organize things anytime — `move` doesn\'t care how old a folder is.',
  'Nothing here ever leaves your machine. No servers, no accounts, no tracking.',
  'Try `color #ff8800` if green isn\'t your color. Any hex works.',
  'A stashed tab isn\'t gone — it\'s just resting. `open` brings it right back.',
];

export async function runCommand(input: string): Promise<CommandOutput> {
  const trimmed = input.trim();
  if (!trimmed) return { lines: [] };

  const args = mri(tokenize(trimmed));
  const [cmd, ...rest] = args._;

  try {
    switch (cmd) {
      case 'help':
        return { lines: plain(HELP_TEXT) };

      case 'clear':
        return { lines: [], clear: true };

      case 'clear-all': {
        await clearAll();
        return { lines: plain(['Moved everything to trash. Type "undo" within 48 hours to bring it all back.']) };
      }

      case 'whoami':
        return { lines: plain(['Just you, some bookmarks, and zero network requests.']) };

      case 'tip':
        return { lines: plain([TIPS[Math.floor(Math.random() * TIPS.length)]!]) };

      case 'berserk':
        return { lines: plain([...BERSERK_ART.split('\n'), '', 'The Black Swordsman approves of your tab hygiene.']) };

      case 'samurai':
        return { lines: plain([...SAMURAI_ART.split('\n'), '', 'A stashed tab is a sheathed blade.']) };

      case 'stash': {
        const category = rest.join(' ') || undefined;
        const result = await stashAllWindows(category);

        const memoryNote = result.memoryFreedBytes ? ` — freed ~${formatBytes(result.memoryFreedBytes)} of memory` : '';
        const lines = [text(`Stashed ${result.tabCount} tab(s) into "${result.folder.title}"${memoryNote}.`)];

        if (result.duplicates.length > 0) {
          lines.push(
            text(
              `Note: ${result.duplicates.length} of these were already saved elsewhere (${[
                ...new Set(result.duplicates.flatMap((d) => d.existingIn)),
              ].join(', ')}).`,
            ),
          );
        }

        return { lines };
      }

      case 'list': {
        const root = await listSessions();
        const lines = renderTree(root);
        return { lines: lines.length ? lines : plain(['(empty — nothing stashed yet)']) };
      }

      case 'open': {
        const folderName = rest.join(' ');
        if (!folderName) return { lines: plain(['Usage: open [folder_name]']) };
        const result = await exportFolder(folderName);
        if (result.urls.length === 0) {
          return { lines: plain([`"${folderName}" has no saved tabs.`]) };
        }
        return {
          lines: [
            text(`"${result.folderTitle}" — ${result.urls.length} tab(s):`),
            ...result.urls.map((u) => link(u, u)),
          ],
        };
      }

      case 'restore': {
        const folderName = rest.join(' ');
        if (!folderName) return { lines: plain(['Usage: restore [folder_name]']) };
        const result = await restoreFolder(folderName);
        if (result.tabCount === 0) {
          return { lines: plain([`"${folderName}" has no saved tabs.`]) };
        }
        const extras = [
          result.groupCount ? `${result.groupCount} tab group(s)` : null,
          result.pinnedCount ? `${result.pinnedCount} pinned` : null,
        ].filter(Boolean);
        const suffix = extras.length ? ` (restored ${extras.join(', ')})` : '';
        return {
          lines: plain([`Restored "${result.folderTitle}" — ${result.tabCount} tab(s) in this window${suffix}.`]),
        };
      }

      case 'copy': {
        const folderName = rest.join(' ');
        if (!folderName) return { lines: plain(['Usage: copy [folder_name]']) };
        const result = await exportFolder(folderName);
        if (result.urls.length === 0) {
          return { lines: plain([`"${folderName}" has no saved tabs.`]) };
        }
        await navigator.clipboard.writeText(result.markdown);
        return {
          lines: [
            text(`Copied ${result.urls.length} URL(s) from "${result.folderTitle}" to clipboard:`),
            ...result.urls.map((u) => link(u, u)),
          ],
        };
      }

      case 'mkdir': {
        const name = rest.join(' ');
        if (!name) return { lines: plain(['Usage: mkdir [category]']) };
        const folder = await createCategory(name);
        return { lines: plain([`Created category "${folder.title}".`]) };
      }

      case 'rename': {
        const [folder, newName] = rest;
        if (!folder || !newName) {
          return { lines: plain(['Usage: rename [folder] [new_name]  (quote names with spaces)']) };
        }
        const updated = await renameFolder(folder, newName);
        return { lines: plain([`Renamed "${folder}" to "${updated.title}".`]) };
      }

      case 'move': {
        const [folder, category] = rest;
        if (!folder || !category) {
          return { lines: plain(['Usage: move [folder] [category]  (quote names with spaces)']) };
        }
        await moveFolder(folder, category);
        return { lines: plain([`Moved "${folder}" into "${category}".`]) };
      }

      case 'rm': {
        const name = rest.join(' ');
        if (!name) return { lines: plain(['Usage: rm [folder]']) };
        await removeFolder(name);
        return { lines: plain([`Deleted "${name}". Type "undo" within 48 hours to bring it back.`]) };
      }

      case 'trash': {
        const trashed = await listTrash();
        if (trashed.length === 0) return { lines: plain(['Trash is empty.']) };

        const lines = trashed.map((t) => {
          const hoursLeft = Math.max(0, Math.round((t.expiresAt - Date.now()) / (60 * 60 * 1000)));
          return `${t.title} — ${t.tabCount} tab(s), gone for good in ~${hoursLeft}h`;
        });
        return { lines: plain([`${trashed.length} folder(s) in trash:`, ...lines]) };
      }

      case 'undo': {
        const name = rest.join(' ');
        if (name) {
          const title = await restoreFromTrash(name);
          return { lines: plain([`Restored "${title}" from trash.`]) };
        }

        const result = await undoLastDelete();
        if (!result) return { lines: plain(['Nothing to undo.']) };
        return {
          lines: plain([
            result.titles.length > 1
              ? `Restored ${result.titles.length} folder(s): ${result.titles.join(', ')}.`
              : `Restored "${result.titles[0]}".`,
          ]),
        };
      }

      case 'focus': {
        if (rest[0]?.toLowerCase() === 'cancel') {
          const cancelled = await cancelFocusSession();
          return {
            lines: plain([cancelled ? `Cancelled the focus session for "${cancelled}".` : 'No focus session is running.']),
          };
        }

        if (rest.length === 0) {
          const status = await getFocusSessionStatus();
          if (!status) return { lines: plain(['No focus session is running.']) };
          const minsLeft = Math.max(0, Math.round((status.endsAt - Date.now()) / 60_000));
          return {
            lines: plain([`Focus session for "${status.folderTitle}" — ~${minsLeft} minute(s) left.`]),
          };
        }

        const last = rest[rest.length - 1];
        const parsedMinutes = last ? Number.parseFloat(last) : NaN;
        const hasMinutes = Number.isFinite(parsedMinutes) && parsedMinutes > 0;
        const folderName = (hasMinutes ? rest.slice(0, -1) : rest).join(' ');
        const minutes = hasMinutes ? parsedMinutes : 25;

        if (!folderName) return { lines: plain(['Usage: focus [folder] [minutes]  (defaults to 25 minutes)']) };

        const status = await startFocusSession(folderName, minutes);
        return {
          lines: plain([
            `Focus session started for "${status.folderTitle}" — ${minutes} minute(s). It'll auto re-stash and close when time's up.`,
          ]),
        };
      }

      case 'share': {
        const folderName = rest.join(' ');
        if (!folderName) return { lines: plain(['Usage: share [folder]']) };
        const url = await shareFolder(folderName);
        return { lines: [text(`Shared "${folderName}" — link:`), link(url, url)] };
      }

      case 'find': {
        if (rest.length === 0) {
          return {
            lines: plain(['Usage: find [category|link|date] [query]  (mode is optional, defaults to "all")']),
          };
        }
        const maybeMode = rest[0]?.toLowerCase() as SearchMode | undefined;
        const hasMode = maybeMode !== undefined && SEARCH_MODES.includes(maybeMode);
        const mode: SearchMode = hasMode ? maybeMode! : 'all';
        const query = (hasMode ? rest.slice(1) : rest).join(' ');

        if (!query) return { lines: plain(['Usage: find [category|link|date] [query]']) };

        const results = await searchStash(query, mode);
        if (results.length === 0) {
          return { lines: plain([`No matches for "${query}".`]) };
        }

        const resultLines = results.map((r) => {
          const { timestamp, label } = parseEntryTitle(r.title);
          const path = r.folderPath.length ? ` [${r.folderPath.join(' / ')}]` : '';
          return link(`${label}${path}${timestamp ? `  (${timestamp})` : ''}`, r.url);
        });

        return { lines: [text(`${results.length} match(es) for "${query}":`), ...resultLines] };
      }

      case 'color': {
        const hex = rest[0];
        if (!hex) {
          const current = await getTerminalColor();
          return { lines: plain([`Current terminal color: ${current}`]) };
        }
        if (!isValidHexColor(hex)) {
          return { lines: plain([`"${hex}" is not a valid hex color (e.g. #737373).`]) };
        }
        await setTerminalColor(hex);
        return { lines: plain([`Terminal color set to ${hex}.`]), colorChange: hex };
      }

      case 'keep-open': {
        const arg = rest[0]?.toLowerCase();
        if (!arg) {
          const current = await getKeepBrowserOpen();
          return {
            lines: plain([
              `Keep browser open on stash: ${current ? 'on' : 'off'}.`,
              current
                ? 'If a stash would close every open tab, a fresh new tab is left behind first.'
                : 'A stash that closes every open tab will close the browser itself.',
            ]),
          };
        }
        if (arg !== 'on' && arg !== 'off') {
          return { lines: plain(['Usage: keep-open [on|off]']) };
        }
        await setKeepBrowserOpen(arg === 'on');
        return {
          lines: plain([
            arg === 'on'
              ? 'Keep browser open: on. A stash that would close every tab now leaves a fresh one behind.'
              : 'Keep browser open: off. A stash that closes every open tab will close the browser itself.',
          ]),
        };
      }

      default:
        return { lines: plain([`Unknown command: "${cmd}". Type "help" for a list of commands.`]) };
    }
  } catch (err) {
    return { lines: plain([`Error: ${err instanceof Error ? err.message : String(err)}`]) };
  }
}
