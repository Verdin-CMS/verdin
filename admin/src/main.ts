import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Apply the dark theme before the first render (the Theme service keeps it in sync).
try {
  const theme = JSON.parse(localStorage.getItem('verdin.preferences') ?? '{}')?.theme;
  const dark = theme === 'dark' || (!theme && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
} catch {
  // Storage unavailable: the Theme service decides at bootstrap.
}

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
