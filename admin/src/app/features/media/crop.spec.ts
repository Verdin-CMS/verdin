import { describe, expect, it } from 'vitest';

import {
  cropOutputType,
  croppable,
  initialBox,
  moveBox,
  nudgeBox,
  pixelBox,
  resizeBox,
} from './crop';

describe('image crop', () => {
  it('starts from the largest centred box of the aspect', () => {
    expect(initialBox('free', 400, 300)).toEqual({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
    expect(initialBox('1:1', 400, 200)).toEqual({ x: 0.25, y: 0, width: 0.5, height: 1 });
    expect(initialBox('16:9', 1600, 1600)).toEqual({ x: 0, y: 0.219, width: 1, height: 0.563 });
  });

  it('moves and resizes inside the image', () => {
    const box = { x: 0.5, y: 0.5, width: 0.4, height: 0.4 };
    expect(moveBox(box, 0.5, -1)).toEqual({ x: 0.6, y: 0, width: 0.4, height: 0.4 });
    expect(resizeBox(box, 1, 1, 'free', 100, 100)).toEqual({
      x: 0.5,
      y: 0.5,
      width: 0.5,
      height: 0.5,
    });
    expect(resizeBox(box, -1, 0, 'free', 100, 100).width).toBe(0.02);
    // 4:3 on a square image: the height follows the width.
    expect(resizeBox({ x: 0, y: 0, width: 0.4, height: 0.3 }, 0.2, 0, '4:3', 100, 100)).toEqual({
      x: 0,
      y: 0,
      width: 0.6,
      height: 0.45,
    });
  });

  it('nudges with the arrow keys', () => {
    const box = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
    expect(nudgeBox(box, 'ArrowRight', false, 'free', 100, 100)?.x).toBe(0.11);
    expect(nudgeBox(box, 'ArrowUp', false, 'free', 100, 100)?.y).toBe(0.09);
    expect(nudgeBox(box, 'ArrowDown', true, 'free', 100, 100)?.height).toBe(0.51);
    expect(nudgeBox(box, 'Enter', false, 'free', 100, 100)).toBeNull();
  });

  it('knows what it can crop and converts to pixels', () => {
    expect(croppable('image/png')).toBe(true);
    expect(croppable('image/svg+xml')).toBe(false);
    expect(croppable('image/gif')).toBe(false);
    expect(cropOutputType('image/bmp')).toBe('image/png');
    expect(cropOutputType('image/jpeg')).toBe('image/jpeg');
    expect(pixelBox({ x: 0.25, y: 0, width: 0.5, height: 1 }, 400, 200)).toEqual({
      x: 100,
      y: 0,
      width: 200,
      height: 200,
    });
  });
});
