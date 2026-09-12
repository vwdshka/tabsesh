<script lang="ts">
  interface Props {
    name:
      | 'trash'
      | 'copy'
      | 'external-link'
      | 'chevron-down'
      | 'search'
      | 'plus'
      | 'move'
      | 'link'
      | 'folder'
      | 'sparkle'
      | 'inbox'
      | 'window'
      | 'edit'
      | 'clock'
      | 'share'
      | 'key';
    class?: string;
  }

  let { name, class: className = '' }: Props = $props();
</script>

<svg
  class={className}
  width="16"
  height="16"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === 'trash'}
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  {:else if name === 'copy'}
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
  {:else if name === 'external-link'}
    <path d="M14 4h6v6" />
    <path d="M20 4 10 14" />
    <path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
  {:else if name === 'chevron-down'}
    <path d="M6 9l6 6 6-6" />
  {:else if name === 'search'}
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  {:else if name === 'plus'}
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  {:else if name === 'move'}
    <path d="M4 12h13" />
    <path d="M13 6l6 6-6 6" />
  {:else if name === 'link'}
    <path d="M9 12a4 4 0 0 0 5 3.9l3-3a4 4 0 0 0-5.6-5.7l-1 .9" />
    <path d="M15 12a4 4 0 0 0-5-3.9l-3 3a4 4 0 0 0 5.6 5.7l1-.9" />
  {:else if name === 'folder'}
    <path d="M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6z" />
  {:else if name === 'sparkle'}
    <path d="M12 3v4" />
    <path d="M12 17v4" />
    <path d="M3 12h4" />
    <path d="M17 12h4" />
    <path d="M5.6 5.6l2.8 2.8" />
    <path d="M15.6 15.6l2.8 2.8" />
    <path d="M18.4 5.6l-2.8 2.8" />
    <path d="M8.4 15.6l-2.8 2.8" />
  {:else if name === 'inbox'}
    <path d="M4 12h4l2 3h4l2-3h4" />
    <path d="M5.5 6h13l2 6v7a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1v-7z" />
  {:else if name === 'window'}
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 9h18" />
    <path d="M7 7h.01" />
    <path d="M10 7h.01" />
  {:else if name === 'edit'}
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  {:else if name === 'clock'}
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  {:else if name === 'share'}
    <circle cx="18" cy="5" r="2.5" />
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="19" r="2.5" />
    <path d="M8.3 10.7l7.4-4.4" />
    <path d="M8.3 13.3l7.4 4.4" />
  {:else if name === 'key'}
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l9-9" />
    <path d="M16 7l2.5 2.5" />
    <path d="M13 10l2 2" />
  {/if}
</svg>
