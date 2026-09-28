import { describe, expect, it, vi } from 'vitest';

import { collectExtensions, createModuleLoader, resolvePluginPath } from './plugin-extensions';
import { PluginExtension } from './plugins';

describe('createModuleLoader', () => {
  it('imports each URL once, sharing concurrent calls', async () => {
    const importer = vi.fn(async (_url: string) => ({}));
    const load = createModuleLoader(importer);
    const results = await Promise.all([load('/a.js'), load('/a.js'), load('/b.js')]);
    expect(results).toEqual([true, true, true]);
    expect(await load('/a.js')).toBe(true);
    expect(importer).toHaveBeenCalledTimes(2);
    expect(importer.mock.calls.map(([url]) => url)).toEqual(['/a.js', '/b.js']);
  });

  it('logs failures and retries on a later call', async () => {
    const log = vi.fn();
    let attempts = 0;
    const load = createModuleLoader(async () => {
      attempts++;
      if (attempts === 1) throw new Error('boom');
    }, log);
    expect(await load('/a.js')).toBe(false);
    expect(log).toHaveBeenCalledOnce();
    expect(await load('/a.js')).toBe(true);
    expect(await load('/a.js')).toBe(true);
    expect(attempts).toBe(2);
  });
});

describe('collectExtensions', () => {
  const extensions: PluginExtension[] = [
    {
      plugin: 'colors',
      script: '/admin/plugins/colors/index.js',
      widgets: [{ id: 'stats', title: 'Stats', element: 'colors-stats' }],
      fields: [
        { id: 'color', title: 'Color', element: 'colors-color', type: 'string' },
        { id: 'color', title: 'Duplicate', element: 'colors-color', type: 'string' },
        { id: 'broken', title: 'Broken', element: 'colors-missing', type: 'json' },
      ],
    },
    {
      plugin: 'failing',
      script: '/admin/plugins/failing/index.js',
      widgets: [{ id: 'w', title: 'W', element: 'failing-w' }],
      fields: [],
    },
  ];

  it('keeps loaded scripts and defined elements, without duplicates', () => {
    const result = collectExtensions(
      extensions,
      (extension) => extension.plugin !== 'failing',
      (element) => element !== 'colors-missing',
    );
    expect(result.widgets).toEqual([
      { id: 'stats', title: 'Stats', element: 'colors-stats', plugin: 'colors' },
    ]);
    expect(result.fields).toEqual([
      { id: 'color', title: 'Color', element: 'colors-color', type: 'string', plugin: 'colors' },
    ]);
  });
});

describe('resolvePluginPath', () => {
  it('keeps absolute URLs and paths under an API base', () => {
    expect(resolvePluginPath('https://x.test/a', '/admin/api', '/api')).toBe('https://x.test/a');
    expect(resolvePluginPath('/admin/api/content/x', '/admin/api', '/api')).toBe(
      '/admin/api/content/x',
    );
    expect(resolvePluginPath('/api/plugins/x?a=1', '/admin/api', '/api')).toBe(
      '/api/plugins/x?a=1',
    );
  });

  it('resolves anything else against the admin API', () => {
    expect(resolvePluginPath('/content-types', '/admin/api', '/api')).toBe(
      '/admin/api/content-types',
    );
    expect(resolvePluginPath('users/me', '/admin/api/', '/api')).toBe('/admin/api/users/me');
    expect(resolvePluginPath('/apix', '/admin/api', '/api')).toBe('/admin/api/apix');
  });
});
