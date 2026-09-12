import { mount } from 'svelte';
import App from './App.svelte';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import '../../assets/tailwind.css';

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
