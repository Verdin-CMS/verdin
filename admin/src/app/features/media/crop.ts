/** A crop box in fractions of the image (0–1), from its top-left corner. */
export interface CropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CropAspect = 'free' | '1:1' | '4:3' | '16:9';

export const CROP_ASPECTS: readonly CropAspect[] = ['free', '1:1', '4:3', '16:9'];

/** The smallest box side, as a fraction of the image. */
const MIN = 0.02;

const RATIOS: Record<Exclude<CropAspect, 'free'>, number> = {
  '1:1': 1,
  '4:3': 4 / 3,
  '16:9': 16 / 9,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Rounds to a thousandth, so boxes compare cleanly. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function rounded(box: CropBox): CropBox {
  return {
    x: round(box.x),
    y: round(box.y),
    width: round(box.width),
    height: round(box.height),
  };
}

/** Raster images a canvas can crop (not SVG, not animated GIF). */
export function croppable(mime: string): boolean {
  return ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/avif'].includes(mime);
}

/** The type a cropped image is encoded as: its own when a canvas can write it, else PNG. */
export function cropOutputType(mime: string): string {
  return ['image/png', 'image/jpeg', 'image/webp'].includes(mime) ? mime : 'image/png';
}

/**
 * The largest centred box of `aspect` for an image of `width` × `height` pixels (a margin
 * of 10% for the free box, so its handles show).
 */
export function initialBox(aspect: CropAspect, width: number, height: number): CropBox {
  if (aspect === 'free' || !width || !height) return { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
  const ratio = RATIOS[aspect];
  // Box height in fractions for a full-width box: (1 * width) / ratio / height.
  let boxWidth = 1;
  let boxHeight = width / ratio / height;
  if (boxHeight > 1) {
    boxHeight = 1;
    boxWidth = (height * ratio) / width;
  }
  return rounded({
    x: (1 - boxWidth) / 2,
    y: (1 - boxHeight) / 2,
    width: boxWidth,
    height: boxHeight,
  });
}

/** Moves the box by `dx`, `dy` (fractions), inside the image. */
export function moveBox(box: CropBox, dx: number, dy: number): CropBox {
  return rounded({
    ...box,
    x: clamp(box.x + dx, 0, 1 - box.width),
    y: clamp(box.y + dy, 0, 1 - box.height),
  });
}

/**
 * Resizes the box from its bottom-end corner by `dx`, `dy` (fractions), inside the image.
 * With an aspect, the height follows the width.
 */
export function resizeBox(
  box: CropBox,
  dx: number,
  dy: number,
  aspect: CropAspect,
  imageWidth: number,
  imageHeight: number,
): CropBox {
  let width = clamp(box.width + dx, MIN, 1 - box.x);
  let height = clamp(box.height + dy, MIN, 1 - box.y);
  if (aspect !== 'free' && imageWidth && imageHeight) {
    const ratio = RATIOS[aspect];
    // Pixel ratio (width * W) / (height * H) = ratio.
    const fromWidth = (width * imageWidth) / ratio / imageHeight;
    if (box.y + fromWidth <= 1 && fromWidth >= MIN) {
      height = fromWidth;
    } else {
      height = clamp(height, MIN, 1 - box.y);
      width = (height * imageHeight * ratio) / imageWidth;
    }
  }
  return rounded({ ...box, width, height });
}

/** A keyboard nudge: arrows move the box, Shift+arrows resize it; `null` for other keys. */
export function nudgeBox(
  box: CropBox,
  key: string,
  shift: boolean,
  aspect: CropAspect,
  imageWidth: number,
  imageHeight: number,
): CropBox | null {
  // Physical directions: the image is never mirrored, right to left included.
  const step = 0.01;
  const deltas: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const delta = deltas[key];
  if (!delta) return null;
  return shift
    ? resizeBox(box, delta[0], delta[1], aspect, imageWidth, imageHeight)
    : moveBox(box, delta[0], delta[1]);
}

/** The box in whole pixels of an image of `width` × `height`. */
export function pixelBox(
  box: CropBox,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const x = Math.round(box.x * width);
  const y = Math.round(box.y * height);
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.round(box.width * width))),
    height: Math.max(1, Math.min(height - y, Math.round(box.height * height))),
  };
}
