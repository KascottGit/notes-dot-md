import { describe, expect, it } from 'vitest';
import { keyboardHeight, revealDelta } from './keyboardFit';

describe('keyboardHeight', () => {
  it('is the covered part of the window', () => {
    expect(keyboardHeight(844, 508)).toBe(336);
  });

  it('is 0 without a keyboard, also for small differences like a browser bar', () => {
    expect(keyboardHeight(844, 844)).toBe(0);
    expect(keyboardHeight(844, 800)).toBe(0);
  });
});

describe('revealDelta', () => {
  const box = { top: 100, bottom: 500 };

  it('leaves a visible caret alone', () => {
    expect(revealDelta({ top: 200, bottom: 220 }, box, 32)).toBe(0);
  });

  it('scrolls down to show a caret under the keyboard, with a margin', () => {
    expect(revealDelta({ top: 600, bottom: 620 }, box, 32)).toBe(152);
  });

  it('scrolls up to show a caret above the box', () => {
    expect(revealDelta({ top: 50, bottom: 70 }, box, 32)).toBe(-82);
  });

  it('uses a smaller margin when the box is tiny', () => {
    expect(revealDelta({ top: 140, bottom: 160 }, { top: 100, bottom: 130 }, 32)).toBe(35);
  });
});
