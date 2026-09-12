import { mount } from 'svelte';
import OverlayApp from './OverlayApp.svelte';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '../../assets/tailwind.css';

const app = mount(OverlayApp, {
  target: document.getElementById('app')!,
});

export default app;
