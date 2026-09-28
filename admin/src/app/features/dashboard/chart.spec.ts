import { describe, expect, it } from 'vitest';

import { StatsPoint, buildChart, niceMax } from './chart';

const points: StatsPoint[] = [
  { date: '2026-09-01', created: 0, published: 0 },
  { date: '2026-09-02', created: 4, published: 1 },
  { date: '2026-09-03', created: 7, published: 3 },
];

describe('niceMax', () => {
  it('rounds up to 1, 2 or 5 times a power of ten', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(3)).toBe(5);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(10)).toBe(10);
    expect(niceMax(11)).toBe(20);
    expect(niceMax(250)).toBe(500);
    expect(niceMax(Number.NaN)).toBe(1);
  });
});

describe('buildChart', () => {
  it('scales to the rounded maximum', () => {
    const chart = buildChart(points, ['created', 'published'], 100, 50);
    expect(chart.max).toBe(10);
    expect(chart.ticks).toEqual([0, 5, 10]);
    expect(chart.tickY).toEqual([50, 25, 0]);
  });

  it('builds line paths edge to edge', () => {
    const [created, published] = buildChart(points, ['created', 'published'], 100, 50).lines;
    expect(created.path).toBe('M0 50 L50 30 L100 15');
    expect(created.area).toBe('M0 50 L50 30 L100 15 L100 50 L0 50 Z');
    expect(created.sum).toBe(11);
    expect(published.sum).toBe(4);
    expect(published.points.map((point) => point.y)).toEqual([50, 45, 35]);
  });

  it('groups bars in equal bands', () => {
    const [created, published] = buildChart(points, ['created', 'published'], 300, 100).lines;
    // Bands of 100, 80% wide, split between two series.
    expect(created.bars[0]).toMatchObject({ x: 10, width: 40, height: 0, y: 100 });
    expect(published.bars[0]).toMatchObject({ x: 50, width: 40 });
    expect(created.bars[2]).toMatchObject({ x: 210, y: 30, height: 70 });
  });

  it('handles a single point and no data', () => {
    const single = buildChart([points[1]], ['created'], 100, 50);
    expect(single.lines[0].path).toBe('M50 10');
    const empty = buildChart([], ['created'], 100, 50);
    expect(empty.max).toBe(1);
    expect(empty.lines[0]).toMatchObject({ path: '', area: '', sum: 0, bars: [] });
  });
});
