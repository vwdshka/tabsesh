<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  interface Props {
    color: string;
    onExit: (score: number) => void;
  }

  let { color, onExit }: Props = $props();

  const COLS = 24;
  const ROWS = 16;
  const CELL = 22;
  const TICK_MS = 110;
  const FOOD_COLOR = '#f87171';

  type Point = { x: number; y: number };

  let canvasEl: HTMLCanvasElement | undefined;
  let ctx: CanvasRenderingContext2D | null = null;

  let snake: Point[] = [{ x: 10, y: 8 }, { x: 9, y: 8 }, { x: 8, y: 8 }];
  let direction: Point = { x: 1, y: 0 };
  let nextDirection: Point = direction;
  let food: Point = randomFood();
  let score = $state(0);
  let gameOver = $state(false);
  let intervalId: ReturnType<typeof setInterval> | undefined;

  function randomFood(): Point {
    let candidate: Point;
    do {
      candidate = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) };
    } while (snake.some((s) => s.x === candidate.x && s.y === candidate.y));
    return candidate;
  }

  function draw() {
    if (!ctx || !canvasEl) return;
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, canvasEl.width, canvasEl.height);

    ctx.fillStyle = color;
    for (const segment of snake) {
      ctx.fillRect(segment.x * CELL + 1, segment.y * CELL + 1, CELL - 2, CELL - 2);
    }

    const fx = food.x * CELL + CELL / 2;
    const fy = food.y * CELL + CELL / 2;
    const radius = CELL / 2 - 3;

    ctx.fillStyle = FOOD_COLOR;
    ctx.beginPath();
    ctx.arc(fx, fy, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#4ade80';
    ctx.fillRect(fx - 1.5, fy - radius - 4, 3, 5);
  }

  function tick() {
    if (gameOver) return;
    direction = nextDirection;
    const head = snake[0]!;
    const newHead: Point = { x: head.x + direction.x, y: head.y + direction.y };

    const hitWall = newHead.x < 0 || newHead.x >= COLS || newHead.y < 0 || newHead.y >= ROWS;
    const hitSelf = snake.some((s) => s.x === newHead.x && s.y === newHead.y);

    if (hitWall || hitSelf) {
      gameOver = true;
      draw();
      return;
    }

    snake = [newHead, ...snake];
    if (newHead.x === food.x && newHead.y === food.y) {
      score += 1;
      food = randomFood();
    } else {
      snake.pop();
    }

    draw();
  }

  function handleKeydown(e: KeyboardEvent) {
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        if (direction.y === 0) nextDirection = { x: 0, y: -1 };
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (direction.y === 0) nextDirection = { x: 0, y: 1 };
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (direction.x === 0) nextDirection = { x: -1, y: 0 };
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (direction.x === 0) nextDirection = { x: 1, y: 0 };
        break;
      case 'Escape':
        e.preventDefault();
        onExit(score);
        break;
      case 'Enter':
        if (gameOver) {
          e.preventDefault();
          onExit(score);
        }
        break;
    }
  }

  onMount(() => {
    ctx = canvasEl?.getContext('2d') ?? null;
    draw();
    intervalId = setInterval(tick, TICK_MS);
    window.addEventListener('keydown', handleKeydown);
  });

  onDestroy(() => {
    if (intervalId) clearInterval(intervalId);
    window.removeEventListener('keydown', handleKeydown);
  });
</script>

<div class="flex w-1/2 min-w-[280px] flex-col items-center gap-2 py-2">
  <canvas
    bind:this={canvasEl}
    width={COLS * CELL}
    height={ROWS * CELL}
    style={`aspect-ratio: ${COLS * CELL} / ${ROWS * CELL}`}
    class="h-auto w-full rounded-lg border border-border"
  ></canvas>
  <p class="text-xs text-ink-muted">
    Score: <span style={`color: ${color}`}>{score}</span>
    {#if gameOver}
      &nbsp;— Game over. Press Enter or Esc to exit.
    {:else}
      &nbsp;— Arrow keys to steer, Esc to quit.
    {/if}
  </p>
</div>
