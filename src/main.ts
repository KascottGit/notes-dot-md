// Fonts are bundled with the app (no requests to font services).
import '@fontsource-variable/source-serif-4/opsz.css';
import '@fontsource-variable/source-serif-4/opsz-italic.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/jetbrains-mono/wght-italic.css';
import { mount } from 'svelte';
import './app.css';
import App from './ui/App.svelte';
import { preventZoom } from './ui/preventZoom';

preventZoom();

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app element');

export default mount(App, { target });
