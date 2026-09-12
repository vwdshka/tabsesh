<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listSessions, flattenEntries } from '../core/bookmarks';
  import { getFaviconUrl } from '../core/favicon';

  interface Props {
    onExit: () => void;
  }

  let { onExit }: Props = $props();

  const WIDTH = 560;
  const HEIGHT = 320;
  const LABEL = 'TabSesh';
  const FONT = '700 24px "JetBrains Mono", ui-monospace, monospace';
  const ICON_BOX = 72;
  const PALETTE = ['#7dd3a8', '#f87171', '#60a5fa', '#facc15', '#c084fc', '#fb923c', '#34d399'];

  let canvasEl: HTMLCanvasElement | undefined;
  let ctx: CanvasRenderingContext2D | null = null;
  let x = WIDTH / 2 - 60;
  let y = HEIGHT / 2 - 20;
  let vx = 2.6;
  let vy = 2.1;
  let colorIndex = 0;
  let bounces = $state(0);
  let boxW = 140;
  let boxH = 44;
  let rafId: number;

  let urlPool: string[] = []; // stashed urls, for real favicons to bounce around
  let currentIcon: HTMLImageElement | null = null;

  function loadRandomIcon() {
    if (urlPool.length === 0) return;
    const url = urlPool[Math.floor(Math.random() * urlPool.length)]!;
    const img = new Image();
    img.onload = () => {
      currentIcon = img;
    };
    img.src = getFaviconUrl(url, 64);
  }

  function roundedRect(x0: number, y0: number, w: number, h: number, r: number) {
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0);
    ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, r);
    ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
    ctx.arcTo(x0, y0 + h, x0, y0, r);
    ctx.arcTo(x0, y0, x0 + w, y0, r);
    ctx.closePath();
  }

  function step() {
    if (!ctx || !canvasEl) return;

    x += vx;
    y += vy;
    let bounced = false;

    if (x <= 0) {
      x = 0;
      vx *= -1;
      bounced = true;
    } else if (x + boxW >= WIDTH) {
      x = WIDTH - boxW;
      vx *= -1;
      bounced = true;
    }

    if (y <= 0) {
      y = 0;
      vy *= -1;
      bounced = true;
    } else if (y + boxH >= HEIGHT) {
      y = HEIGHT - boxH;
      vy *= -1;
      bounced = true;
    }

    if (bounced) {
      colorIndex = (colorIndex + 1) % PALETTE.length;
      bounces += 1;
      loadRandomIcon();
    }

    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const c = PALETTE[colorIndex]!;
    ctx.fillStyle = c;
    roundedRect(x, y, boxW, boxH, 10);
    ctx.fill();

    if (currentIcon) {
      const pad = 16;
      const size = Math.min(boxW, boxH) - pad * 2;
      ctx.drawImage(currentIcon, x + (boxW - size) / 2, y + (boxH - size) / 2, size, size);
    } else {
      ctx.fillStyle = '#0a0a0c';
      ctx.font = FONT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(LABEL, x + boxW / 2, y + boxH / 2 + 1);
    }

    rafId = requestAnimationFrame(step);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onExit();
    }
  }

  onMount(async () => {
    ctx = canvasEl?.getContext('2d') ?? null;

    try {
      const entries = flattenEntries(await listSessions());
      urlPool = [...new Set(entries.map((e) => e.url))];
    } catch {
      urlPool = [];
    }

    if (urlPool.length > 0) {
      boxW = ICON_BOX;
      boxH = ICON_BOX;
      loadRandomIcon();
    } else if (ctx) {
      ctx.font = FONT;
      boxW = ctx.measureText(LABEL).width + 32;
    }

    rafId = requestAnimationFrame(step);
    // delayed so the Enter that launched `dvd` can't also be the keypress that closes it
    setTimeout(() => window.addEventListener('keydown', handleKeydown), 0);
  });

  onDestroy(() => {
    cancelAnimationFrame(rafId);
    window.removeEventListener('keydown', handleKeydown);
  });
</script>

<div class="flex w-1/2 min-w-[280px] flex-col items-center gap-2 py-2">
  <canvas
    bind:this={canvasEl}
    width={WIDTH}
    height={HEIGHT}
    style={`aspect-ratio: ${WIDTH} / ${HEIGHT}`}
    class="h-auto w-full rounded-lg border border-border"
  ></canvas>
  <p class="text-xs text-ink-muted">
    Corner hits: <span class="text-ink">{bounces}</span> — Esc to quit. It will never actually hit the corner.
  </p>
</div>
