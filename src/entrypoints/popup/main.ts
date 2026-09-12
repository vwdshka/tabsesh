import { mount } from 'svelte';
import App from './App.svelte';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './app.css';

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
