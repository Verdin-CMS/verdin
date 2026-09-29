// Open Graph card for every docs page: /og/<page id>.png, referenced by
// src/route-data.ts. The title in Anybody, the description in Atkinson, on the site's
// mineral dark with a copper edge.
import { getCollection } from 'astro:content';
import { OGImageRoute } from 'astro-og-canvas';

const entries = await getCollection('docs');
const pages = Object.fromEntries(entries.map(({ id, data }) => [id, data]));
const fonts = './node_modules/@fontsource-variable';

export const { getStaticPaths, GET } = await OGImageRoute({
  param: 'route',
  pages,
  getImageOptions: (_path, page: (typeof pages)[string]) => ({
    title: page.hero?.title?.replace(/<[^>]+>/g, '') ?? page.title,
    description: page.description,
    bgGradient: [
      [13, 23, 21],
      [22, 35, 31],
    ],
    border: { color: [199, 116, 63], width: 18, side: 'inline-start' },
    padding: 80,
    logo: { path: './src/assets/og-logo.png', size: [96] },
    font: {
      title: {
        families: ['Anybody'],
        weight: 'Bold',
        size: 76,
        lineHeight: 1.05,
        color: [227, 236, 232],
      },
      description: {
        families: ['Atkinson Hyperlegible Next'],
        size: 34,
        lineHeight: 1.4,
        color: [174, 189, 183],
      },
    },
    fonts: [
      `${fonts}/anybody/files/anybody-latin-wght-normal.woff2`,
      `${fonts}/atkinson-hyperlegible-next/files/atkinson-hyperlegible-next-latin-wght-normal.woff2`,
    ],
  }),
});
