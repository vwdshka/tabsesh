<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { runCommand, COMMAND_NAMES, type OutputLine } from '../core/commands';
  import { getTerminalColor, DEFAULT_TERMINAL_COLOR } from '../core/storage';
  import { getFaviconUrl } from '../core/favicon';
  import SnakeGame from './SnakeGame.svelte';
  import DvdScreensaver from './DvdScreensaver.svelte';

  interface Props {
    onRequestClose?: () => void; // Escape on an empty line - lets the quick overlay close itself
    compact?: boolean;
    color?: string; // controlled by a parent when set, falls back to loading it locally if not
    onColorChange?: (hex: string) => void; // fires when the `color` command changes it
  }
  let { onRequestClose, compact = false, color: colorProp, onColorChange }: Props = $props();

  const BANNER_WIDTH = 40;
  function padCenter(s: string, width: number): string {
    const total = Math.max(width - s.length, 0);
    const left = Math.floor(total / 2);
    return ' '.repeat(left) + s + ' '.repeat(total - left);
  }
  const BANNER = [
    `╭${'─'.repeat(BANNER_WIDTH)}╮`,
    `│${padCenter('⌨   T a b S e s h', BANNER_WIDTH)}│`,
    `╰${'─'.repeat(BANNER_WIDTH)}╯`,
  ];

  function greeting(): string {
    const hour = new Date().getHours();
    if (hour < 5) return 'Burning the midnight oil? Type "help" to get started.';
    if (hour < 12) return 'Good morning. Type "help" to see what you can do.';
    if (hour < 18) return 'Good afternoon. Type "help" to see what you can do.';
    return 'Good evening. Type "help" to see what you can do.';
  }

  let standaloneColor = $state(DEFAULT_TERMINAL_COLOR);
  const color = $derived(colorProp ?? standaloneColor);
  let lines = $state<OutputLine[]>([{ text: greeting() }]);
  let input = $state('');
  let history: string[] = [];
  let historyIndex = -1;
  let inputEl: HTMLInputElement | undefined;
  let logEl: HTMLDivElement | undefined;
  let gameActive = $state(false);
  let dvdActive = $state(false);

  const commandNameSet = new Set<string>(COMMAND_NAMES);

  const highlightedTokens = $derived.by(() => {
    const match = input.match(/^(\S+)(\s.*)?$/);
    if (!match) return [] as { text: string; known: boolean | null }[];
    const [, word, restPart] = match;
    const known = commandNameSet.has(word!);
    const tokens: { text: string; known: boolean | null }[] = [{ text: word!, known }];
    if (restPart) tokens.push({ text: restPart, known: null });
    return tokens;
  });

  onMount(async () => {
    if (colorProp === undefined) {
      standaloneColor = await getTerminalColor();
    }
    inputEl?.focus();
  });

  async function scrollToBottom() {
    await tick();
    logEl?.scrollTo({ top: logEl.scrollHeight });
  }

  function pushHistoryLines(limit?: number) {
    const slice = limit ? history.slice(-limit) : history;
    const start = history.length - slice.length;
    const rendered: OutputLine[] = slice.map((cmd, i) => ({ text: `${start + i + 1}  ${cmd}` }));
    lines = [...lines, ...(rendered.length ? rendered : [{ text: '(no commands yet)' }])];
  }

  function exitSnake(score: number) {
    gameActive = false;
    lines = [...lines, { text: `🐍 Snake finished — final score: ${score}` }];
    scrollToBottom();
    tick().then(() => inputEl?.focus());
  }

  function exitDvd() {
    dvdActive = false;
    lines = [...lines, { text: '📀 Screensaver dismissed. Back to work.' }];
    scrollToBottom();
    tick().then(() => inputEl?.focus());
  }

  async function submit() {
    const value = input;
    if (!value.trim()) return;

    lines = [...lines, { text: value.trimEnd() ? `$ ${value}` : '$' }];
    history = [...history, value];
    historyIndex = history.length;
    input = '';

    const [cmd, ...rest] = value.trim().split(/\s+/);

    if (cmd === 'history') {
      const limit = rest[0] ? Number.parseInt(rest[0], 10) : undefined;
      pushHistoryLines(Number.isFinite(limit) ? limit : undefined);
      await scrollToBottom();
      return;
    }

    if (cmd === 'snake') {
      lines = [...lines, { text: '🐍 Loading Snake — arrow keys to steer, Esc to quit.' }];
      await scrollToBottom();
      gameActive = true;
      return;
    }

    if (cmd === 'dvd') {
      lines = [...lines, { text: '📀 Starting screensaver — Esc to quit.' }];
      await scrollToBottom();
      dvdActive = true;
      return;
    }

    const result = await runCommand(value);

    if (result.clear) {
      lines = [];
    } else {
      lines = [...lines, ...result.lines];
    }

    if (result.colorChange) {
      standaloneColor = result.colorChange;
      onColorChange?.(result.colorChange);
    }

    await scrollToBottom();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (gameActive || dvdActive) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape' && onRequestClose) {
      e.preventDefault();
      if (input) {
        input = '';
      } else {
        onRequestClose();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      historyIndex = Math.max(0, historyIndex - 1);
      input = history[historyIndex] ?? '';
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (history.length === 0) return;
      historyIndex = Math.min(history.length, historyIndex + 1);
      input = history[historyIndex] ?? '';
    }
  }

  function focusInput() {
    if (!gameActive && !dvdActive) inputEl?.focus();
  }
</script>

<div
  class="flex h-full flex-col p-4"
  style={`--term-color: ${color};`}
  onclick={focusInput}
  role="presentation"
>
  {#if !gameActive && !dvdActive && !compact}
    <pre
      class="mb-2 select-none whitespace-pre text-center font-mono text-base font-semibold leading-tight sm:text-lg"
      style="color: var(--term-color)"
      aria-hidden="true">{BANNER.join('\n')}</pre>
  {/if}

  {#if gameActive}
    <div class="flex flex-1 items-center justify-center">
      <SnakeGame {color} onExit={exitSnake} />
    </div>
  {:else if dvdActive}
    <div class="flex flex-1 items-center justify-center">
      <DvdScreensaver onExit={exitDvd} />
    </div>
  {:else}
    <div
      bind:this={logEl}
      class="min-h-0 flex-1 overflow-auto pb-2 font-mono text-sm leading-relaxed"
      role="log"
      aria-live="polite"
      aria-label="Terminal output"
    >
      {#each lines as line}
        {#if line.url}
          <p class="whitespace-pre pl-3">
            <img
              src={getFaviconUrl(line.url)}
              alt=""
              class="mr-1 inline-block h-3.5 w-3.5 -translate-y-px rounded-sm align-middle"
              onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')}
            />
            <a
              href={line.url}
              target="_blank"
              rel="noreferrer"
              class="underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-80"
              style="color: var(--term-color)"
            >
              {line.text}
            </a>
          </p>
        {:else if line.text.startsWith('$')}
          <p class="whitespace-pre">
            <span style="color: var(--term-color)">$</span>{line.text.slice(1)}
          </p>
        {:else}
          <p class="whitespace-pre text-ink-muted">{line.text}</p>
        {/if}
      {/each}
    </div>

    <div class="flex items-center gap-2 border-t border-border pt-2">
      <label for="tui-input" class="select-none" style="color: var(--term-color)">$</label>
      <div class="relative flex-1">
        <div
          class="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre font-mono text-sm"
          aria-hidden="true"
        >
          {#each highlightedTokens as tok}
            {#if tok.known === true}
              <span style="color: var(--term-color)">{tok.text}</span>
            {:else if tok.known === false}
              <span class="text-amber-400">{tok.text}</span>
            {:else}
              <span class="text-ink">{tok.text}</span>
            {/if}
          {/each}
        </div>
        <input
          id="tui-input"
          bind:this={inputEl}
          bind:value={input}
          onkeydown={handleKeydown}
          class="relative w-full bg-transparent font-mono text-sm text-transparent outline-none placeholder:text-ink-muted"
          style="caret-color: var(--term-color)"
          placeholder='type a command, e.g. "help"'
          autocomplete="off"
          spellcheck="false"
          aria-label="Terminal command input"
        />
      </div>
    </div>
  {/if}
</div>
