import { describe, expect, it } from 'vitest';

import { encodeQr, qrPath } from './qr';

/** `otpauth://totp/V:a?secret=JBSWY3DP`, level M, mask 3, as the `qrcode` package draws it. */
const REFERENCE = [
  '#######.#....###...##.#######',
  '#.....#.#.#..#..#.....#.....#',
  '#.###.#...##....#.....#.###.#',
  '#.###.#.#.##..##.#....#.###.#',
  '#.###.#..#.##.#.##.#..#.###.#',
  '#.....#..#.#.#.##.###.#.....#',
  '#######.#.#.#.#.#.#.#.#######',
  '........#.##...####..........',
  '#.##.###..##.#.#####..#..#.##',
  '.##.#..#####.###...##.###..##',
  '###..##.#....#...##..#..####.',
  '.#..##..#####...#.....###...#',
  '.##.#.#...#...#####.#....###.',
  '###.#..#..#.#.#.#.##.##..####',
  '#..######..###..#.###.#....##',
  '###....#.#..#.###..###.###.#.',
  '##..###..##...#..###....##.#.',
  '.#..##.#####..#..#.....#...#.',
  '#.###.##...########.#.##.....',
  '..##.......#.###.#..###.#####',
  '.#.##.##.#...##...##########.',
  '........###.#.....#.#...#.###',
  '#######.##..#.#.#..##.#.#.##.',
  '#.....#.#.##.##.#...#...##...',
  '#.###.#...##....#...########.',
  '#.###.#.#.#..#..###..#.##...#',
  '#.###.#.#.#..##..#.####..##.#',
  '#.....#..##..##.#..##..#...#.',
  '#######.#..#.#..###.#.#.#..#.',
];

const draw = (modules: boolean[][]) =>
  modules.map((row) => row.map((dark) => (dark ? '#' : '.')).join(''));

describe('encodeQr', () => {
  it('matches a reference encoding module for module', () => {
    const code = encodeQr('otpauth://totp/V:a?secret=JBSWY3DP', 'M', 3);
    expect(code.version).toBe(3);
    expect(code.size).toBe(29);
    expect(draw(code.modules)).toEqual(REFERENCE);
  });

  it('picks the smallest version that holds the text', () => {
    expect(encodeQr('a', 'M').version).toBe(1);
    expect(encodeQr('x'.repeat(14), 'M').version).toBe(1);
    expect(encodeQr('x'.repeat(15), 'M').version).toBe(2);
    const url =
      'otpauth://totp/Verdin:admin%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Verdin&algorithm=SHA1&digits=6&period=30';
    const code = encodeQr(url, 'M');
    expect(code.version).toBe(8);
    expect(code.size).toBe(49);
    expect(code.mask).toBeGreaterThanOrEqual(0);
    expect(code.mask).toBeLessThan(8);
  });

  it('draws the three finder patterns', () => {
    const { modules, size } = encodeQr('hello');
    const finder = ['#######', '#.....#', '#.###.#', '#.###.#', '#.###.#', '#.....#', '#######'];
    const at = (x: number, y: number) =>
      modules.slice(y, y + 7).map((row) => draw([row.slice(x, x + 7)])[0]);
    expect(at(0, 0)).toEqual(finder);
    expect(at(size - 7, 0)).toEqual(finder);
    expect(at(0, size - 7)).toEqual(finder);
  });

  it('refuses text longer than version 40 holds', () => {
    expect(() => encodeQr('x'.repeat(3000), 'H')).toThrow();
  });

  it('makes an SVG path of the dark modules', () => {
    const code = encodeQr('a');
    const path = qrPath(code, 4);
    const dark = code.modules.flat().filter(Boolean).length;
    expect(path.match(/M/g)?.length).toBe(dark);
    expect(path.startsWith('M4 4h1v1h-1z')).toBe(true);
  });
});
