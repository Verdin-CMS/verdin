import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/auth';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/register').then((m) => m.RegisterPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', loadComponent: () => import('./features/home').then((m) => m.HomePage) },
      {
        path: 'content/:uid',
        loadComponent: () => import('./features/content/list').then((m) => m.ContentList),
      },
      {
        path: 'content/:uid/new',
        loadComponent: () => import('./features/content/edit').then((m) => m.ContentEdit),
      },
      {
        path: 'content/:uid/:documentId',
        loadComponent: () => import('./features/content/edit').then((m) => m.ContentEdit),
      },
      {
        path: 'content/:uid/:documentId/history',
        loadComponent: () => import('./features/content/history').then((m) => m.ContentHistory),
      },
      {
        path: 'single/:uid',
        loadComponent: () => import('./features/content/edit').then((m) => m.ContentEdit),
      },
      {
        path: 'media',
        loadComponent: () => import('./features/media/library').then((m) => m.MediaLibraryPage),
      },
      {
        path: 'builder',
        loadComponent: () => import('./features/builder/builder').then((m) => m.Builder),
      },
      {
        path: 'builder/:name',
        loadComponent: () => import('./features/builder/builder').then((m) => m.Builder),
      },
      {
        path: 'settings/users',
        loadComponent: () => import('./features/settings/users').then((m) => m.UsersPage),
      },
      {
        path: 'settings/roles',
        loadComponent: () => import('./features/settings/roles').then((m) => m.RolesPage),
      },
      {
        path: 'settings/tokens',
        loadComponent: () => import('./features/settings/tokens').then((m) => m.TokensPage),
      },
      {
        path: 'settings/features',
        loadComponent: () => import('./features/settings/features').then((m) => m.FeaturesPage),
      },
      {
        path: 'settings/webhooks',
        loadComponent: () => import('./features/settings/webhooks').then((m) => m.WebhooksPage),
      },
      {
        path: 'settings/webhooks/:id',
        loadComponent: () =>
          import('./features/settings/webhook-edit').then((m) => m.WebhookEditPage),
      },
      {
        path: 'settings/internationalization',
        loadComponent: () => import('./features/settings/locales').then((m) => m.LocalesPage),
      },
      {
        path: 'settings/public',
        loadComponent: () => import('./features/settings/public').then((m) => m.PublicPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
