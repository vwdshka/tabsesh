<script lang="ts">
  import { onMount } from 'svelte';
  import Terminal from '../../lib/tui/Terminal.svelte';
  import Gui from '../../lib/gui/Gui.svelte';
  import {
    getInterfaceMode,
    setInterfaceMode,
    getTerminalColor,
    setTerminalColor,
    DEFAULT_TERMINAL_COLOR,
    type InterfaceMode,
  } from '../../lib/core/storage';

  let mode = $state<InterfaceMode>('gui');
  let ready = $state(false);
  let accentColor = $state(DEFAULT_TERMINAL_COLOR);

  onMount(async () => {
    mode = await getInterfaceMode();
    accentColor = await getTerminalColor();
    ready = true;
  });

  async function switchMode(target: InterfaceMode) {
    if (mode === target) return;
    mode = target;
    await setInterfaceMode(mode);
  }

  async function handleAccentInput(e: Event) {
    const hex = (e.target as HTMLInputElement).value;
    accentColor = hex;
    await setTerminalColor(hex);
  }

  function handleTerminalColorChange(hex: string) {
    accentColor = hex;
  }
</script>

<div class="flex h-screen w-screen flex-col bg-surface text-ink" style={`--color-accent: ${accentColor}`}>
  <header class="flex items-center justify-between border-b border-border px-5 py-3">
    <h1 class="text-base font-medium tracking-wide">TabSesh</h1>

    <div class="flex items-center gap-3">
      <label
        class="relative h-7 w-7 shrink-0 cursor-pointer overflow-hidden rounded-full border border-border transition-transform hover:scale-110"
        title="Accent color — shared by the GUI and the TUI prompt"
      >
        <span class="sr-only">Accent color</span>
        <input
          type="color"
          value={accentColor}
          oninput={handleAccentInput}
          class="absolute -left-1 -top-1 h-9 w-9 cursor-pointer border-none bg-transparent p-0"
        />
      </label>

      <div class="flex items-center gap-0.5 rounded-full border border-border bg-surface-raised p-1 text-xs font-medium">
        <button
          class={`rounded-full px-3 py-1 transition-colors duration-150 ${
            mode === 'gui'
              ? 'bg-accent text-surface-inset'
              : 'text-ink-muted hover:bg-accent/15 hover:text-ink'
          }`}
          onclick={() => switchMode('gui')}
          aria-pressed={mode === 'gui'}
        >
          GUI
        </button>
        <button
          class={`rounded-full px-3 py-1 transition-colors duration-150 ${
            mode === 'tui'
              ? 'bg-accent text-surface-inset'
              : 'text-ink-muted hover:bg-accent/15 hover:text-ink'
          }`}
          onclick={() => switchMode('tui')}
          aria-pressed={mode === 'tui'}
        >
          TUI
        </button>
      </div>
    </div>
  </header>

  <main class="min-h-0 flex-1">
    {#if ready}
      {#if mode === 'gui'}
        <Gui />
      {:else}
        <Terminal color={accentColor} onColorChange={handleTerminalColorChange} />
      {/if}
    {/if}
  </main>
</div>
