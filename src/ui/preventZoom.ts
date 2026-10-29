/**
 * Turn off pinch and double-tap zoom on phones, so the UI and the note stay
 * at their set size.
 *
 * The viewport meta tag (user-scalable=no) and `touch-action: pan-x pan-y`
 * cover Android. iPhone Safari ignores user-scalable=no, so its pinch
 * gesture events are cancelled here as well.
 */
export function preventZoom(): void {
  const cancel = (event: Event) => event.preventDefault();
  // Safari-only gesture events (pinch).
  document.addEventListener('gesturestart', cancel);
  document.addEventListener('gesturechange', cancel);
  document.addEventListener('gestureend', cancel);
  // Two-finger moves are pinches; one finger still scrolls normally.
  document.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length > 1) event.preventDefault();
    },
    { passive: false },
  );
}
