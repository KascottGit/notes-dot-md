/**
 * The entry: small on purpose. A returning user's page load usually leaves
 * for Google right away (the silent sign-in, SPEC "Token handling") and comes
 * back a moment later, so the app is only loaded when the page stays.
 */
import './app.css'; // The page's background, also while leaving.
import { auth } from './auth/google';

const loadApp = () => void import('./app');

auth.init();
if (auth.state.busy) {
  // On the way to Google. If the page is still here after a while, show the app after all.
  const fallback = setTimeout(loadApp, 4000);
  // Shown again from the browser's back/forward cache: start over.
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    clearTimeout(fallback);
    window.location.reload();
  });
} else {
  loadApp();
}
