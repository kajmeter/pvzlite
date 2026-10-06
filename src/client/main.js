// Entry point for the browser / desktop client.
import './styles.css';
import { App } from './app.js';

const app = new App();
// exposed for debugging, automated tests and screenshot tooling
window.__shardfall = app;
app.start();
