// Compiled by `npm run typecheck`: the client accepts the types `verdin types` generates
// (blog-types.ts is the blog example's output, kept in sync by a Rust test).
import { createClient } from '../../src/index.ts';
import type { VerdinSchema } from './blog-types.ts';

const verdin = createClient<VerdinSchema>({ url: 'http://localhost:1337' });

export async function titles(): Promise<string[]> {
  const { data } = await verdin.collection('articles').find({ populate: { category: true } });
  return data.map((article) => article.title);
}

export async function homepage() {
  return verdin.single('homepage').find();
}
