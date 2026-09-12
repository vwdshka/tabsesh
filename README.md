# TabSesh

A Manifest V3 browser extension for people who let tabs pile up until the browser chokes. One shortcut sweeps every open tab into a named, searchable folder and closes them; a terminal-style command line sits next to a normal point-and-click UI, and both drive the exact same code underneath.

## The problem

I kept ending up with 60+ tabs across three windows and no real system for it. The usual answer is a "tab manager" extension, but most of them are either a glorified bookmarks-bar clone or a subscription product with a login screen. I wanted something that:

- keeps everything in the browser's own bookmarks, so it's already synced across my machines without a server or an account
- works from the keyboard, not just a popup full of buttons
- doesn't quietly do something destructive — closing 40 tabs should be undoable, not a gamble

TabSesh is the result. It's a dual-interface tool: a normal GUI for anyone who wants to click, and a small in-browser terminal for anyone who'd rather type `stash` and move on.

## Architecture

```
 ┌───────────┐   ┌────────────────┐   ┌──────────────────┐
 │  Popup    │   │  Full-page app │   │  Quick overlay    │
 │ (1-click  │   │  GUI + TUI,    │   │  injected on any  │
 │  stash)   │   │  same toggle   │   │  page via a hotkey│
 └─────┬─────┘   └───────┬────────┘   └─────────┬─────────┘
       │                 │                      │
       └─────────────────┼──────────────────────┘
                          │
                  src/lib/core/*
        (bookmarks, storage, memory, favicon, share —
              zero UI code, all three call this)
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
  chrome.bookmarks   chrome.tabs /      chrome.storage.local
  (the actual data    tabGroups /       (prefs, trash meta,
   store, no DB)      alarms            focus session state)
```

Every entry point — the popup, the full app, and the overlay injected via `chrome.scripting` — calls the same functions in `src/lib/core`. None of that layer knows or cares which UI is calling it, which is what lets the GUI and the terminal stay in sync without any glue code between them.

## Quickstart

```
npm install
npm run build
```

Then in Chrome: `chrome://extensions` → enable Developer mode → Load unpacked → select `.output/chrome-mv3`.

`npm run dev` gives you a watch build if you're changing things.

## What it does

Stash saves every open tab (title, URL, pinned state, tab group) into a bookmark folder and closes them. Everything else builds on that one action:

| Command | Does |
|---|---|
| `stash [name]` | Save & close every open tab, across all windows |
| `list` | Show every saved folder as a tree |
| `open [folder]` | List a folder's tabs as clickable links |
| `restore [folder]` | Reopen a folder as real tabs, pins and tab groups included |
| `focus [folder] [mins]` | Restore a folder for a set time, then auto re-stash and close it |
| `copy [folder]` | Copy a folder's links to the clipboard |
| `share [folder]` | Publish a folder as a public GitHub Gist |
| `find [mode] [query]` | Search by link, category, or date |
| `mkdir` / `move` / `rename` / `rm` | Organize folders into categories |
| `trash` / `undo` | Deleted folders sit in a trash for 48h before they're gone for good |
| `color [#hex]` | Set the accent color — shared live between the GUI and the terminal |
| `keep-open [on\|off]` | Don't let a stash that closes every tab also close the browser |

The GUI has a button for all of the above; the TUI has the same list under `help`. A few things exist only because a terminal without personality is depressing: `snake`, `dvd` (a bouncing-favicon screensaver pulled from your own stashed tabs), and a couple of ASCII art easter eggs.

## Design decisions

**Bookmarks as the data store, not a database.** Everything TabSesh saves is a literal Chrome bookmark under a `TabSesh` folder. That means sync across devices comes for free from the browser's own account sync, and there's nothing to migrate or back up separately. The tradeoff is that folder names have to stay unique across the whole tree, since every command looks a folder up by name rather than by ID.

**Soft delete everywhere.** `rm` and `clear-all` move folders into a hidden `.trash` folder instead of removing them, and they sit there for 48 hours before actually being purged. A keyboard-driven tool makes it too easy to fat-finger a destructive command, so I'd rather make deletion reversible by default than rely on a confirmation dialog nobody reads.

**One core, two interfaces.** `src/lib/core` has no Svelte in it at all — it's plain TypeScript functions that both the GUI and the TUI call directly. A bug fixed there is fixed in both interfaces at once, and neither one can drift out of sync with the other.

**`chrome.alarms` instead of `setTimeout` for focus sessions.** A Manifest V3 service worker can be killed and restarted by the browser at any point, and a plain JS timer doesn't survive that. `chrome.alarms` does, which is the only reason a 25-minute focus session reliably fires even if the worker went idle in the meantime.

**A user-supplied GitHub token instead of OAuth.** Share needed some way to authenticate without a backend to run an OAuth flow through. A personal access token the user generates themselves (scoped to `gist` only) keeps this a zero-server extension instead of standing up infrastructure for one feature.

**Permissions requested only for what they're for.** The broad `<all_urls>` host permission exists solely so the quick-overlay hotkey can inject on whatever page you're looking at; `alarms`/`notifications` exist solely for focus sessions; `processes` exists solely for the memory-freed estimate. Each one is named in the README FAQ below so it's not a mystery why it's there.

## Testing

`src/lib/core` is plain TypeScript with no browser UI in it, which makes it straightforward to unit test with Vitest — the tricky part was that `@webext-core/fake-browser` (the fake extension APIs WXT recommends for this) doesn't implement `bookmarks` or `tabGroups` at all, since most extensions don't touch either. `test/fake-extras.ts` is a small in-memory fake for just those two, built specifically around what this codebase actually calls.

73 tests cover the bookmark/trash/undo logic, focus sessions, and the TUI command parser. Writing them caught two real bugs before either shipped: `undoLastDelete` would restore the wrong folder if two deletions landed in the same millisecond (fixed with a stable tie-break instead of a plain sort), and a bug in `fake-browser` itself where `tabs.remove()` looks up a window by the tab's own id instead of its `windowId` (worked around in the test harness, not something to fix upstream here).

```
npm run test    # run once
npm run test:watch
```

## What's not here

- No Firefox build, though WXT supports one; I only ever tested Chrome.
- The memory-freed number depends on `chrome.processes`, which isn't guaranteed available on every Chromium build — when it isn't, the number just doesn't show up.

## FAQ

**Does this send anything over the network?**
No, except Share, which is opt-in and only ever talks to `api.github.com`, using a token you provide yourself.

**Why does it ask for permission to run on every site?**
Only for the quick-overlay hotkey. Skip the shortcut and it never needs it.

**Where's my data if I uninstall?**
Still in your bookmarks. Uninstalling the extension doesn't touch the `TabSesh` folder.

## Stack

WXT (Manifest V3 tooling) + Svelte + Tailwind, TypeScript throughout, `mri` for parsing TUI input.

```
npm run check   # type-check
npm run build   # production build → .output/chrome-mv3
```
