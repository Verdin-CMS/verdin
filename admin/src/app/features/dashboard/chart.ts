/** Geometry of the dashboard's small SVG charts (no chart library). */

import { ChartSeries } from '../../core/dashboard';

/** One bucket of `GET /content/{uid}/stats`. */
export interface StatsPoint {
  date: string;
  created: number;
  published: number;
}

export interface ContentStats {
  interval: 'day' | 'week';
  series: StatsPoint[];
  totals: { documents: number; published: number };
}

export interface ChartPoint {
  x: number;
  y: number;
  value: number;
  date: string;
}

export interface ChartBar {
  x: number;
  y: number;
  width: number;
  height: number;
  value: number;
  date: string;
}

export interface ChartLine {
  key: ChartSeries;
  points: ChartPoint[];
  /** `M x y L …` through the points. */
  path: string;
  /** The line closed down to the baseline, for a light fill. */
  area: string;
  bars: ChartBar[];
  /** Sum over the period. */
  sum: number;
}

export interface ChartGeometry {
  width: number;
  height: number;
  /** The top of the scale. */
  max: number;
  /** Values of the horizontal grid lines, bottom to top. */
  ticks: number[];
  /** Grid line heights, matching `ticks`. */
  tickY: number[];
  lines: ChartLine[];
}

/** A round top for a scale: 1, 2 or 5 times a power of ten, at least `value` (and 1). */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 1) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 5, 10]) {
    if (step * power >= value) return step * power;
  }
  return 10 * power;
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Lays out `keys` of `points` in a `width` × `height` box (y grows downwards): line paths
 * with points spread edge to edge, and grouped bars in equal bands.
 */
export function buildChart(
  points: readonly StatsPoint[],
  keys: readonly ChartSeries[],
  width: number,
  height: number,
): ChartGeometry {
  const values = points.flatMap((point) => keys.map((key) => Math.max(0, point[key] ?? 0)));
  const max = niceMax(Math.max(0, ...values));
  const y = (value: number) => round(height - (Math.max(0, value) / max) * height);
  const count = points.length;
  const x = (index: number) => round(count <= 1 ? width / 2 : (index * width) / (count - 1));
  const band = count ? width / count : width;
  const groupWidth = band * 0.8;
  const barWidth = keys.length ? groupWidth / keys.length : groupWidth;

  const lines = keys.map((key, keyIndex): ChartLine => {
    const linePoints = points.map((point, index) => ({
      x: x(index),
      y: y(point[key] ?? 0),
      value: point[key] ?? 0,
      date: point.date,
    }));
    const path = linePoints
      .map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`)
      .join(' ');
    const area = linePoints.length
      ? `${path} L${linePoints[linePoints.length - 1].x} ${height} L${linePoints[0].x} ${height} Z`
      : '';
    const bars = points.map((point, index) => {
      const top = y(point[key] ?? 0);
      return {
        x: round(index * band + (band - groupWidth) / 2 + keyIndex * barWidth),
        y: top,
        width: round(barWidth),
        height: round(height - top),
        value: point[key] ?? 0,
        date: point.date,
      };
    });
    const sum = points.reduce((total, point) => total + (point[key] ?? 0), 0);
    return { key, points: linePoints, path, area, bars, sum };
  });

  const ticks = max % 2 === 0 ? [0, max / 2, max] : [0, max];
  return { width, height, max, ticks, tickY: ticks.map(y), lines };
}
