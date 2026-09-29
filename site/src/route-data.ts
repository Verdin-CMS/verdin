// Adds each page's Open Graph card (src/pages/og) to its <head>.
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

export const onRequest = defineRouteMiddleware((context) => {
  const { entry, head } = context.locals.starlightRoute;
  const image = new URL(`${import.meta.env.BASE_URL.replace(/\/$/, '')}/og/${entry.id}.png`, context.site);
  head.push(
    { tag: 'meta', attrs: { property: 'og:image', content: image.href } },
    { tag: 'meta', attrs: { name: 'twitter:image', content: image.href } },
  );
});
