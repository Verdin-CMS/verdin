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
    path: 'auth/forgot-password',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/forgot-password').then((m) => m.ForgotPasswordPage),
  },
  {
    path: 'auth/reset-password',
    loadComponent: () => import('./features/auth/reset-password').then((m) => m.ResetPasswordPage),
  },
  {
    path: 'auth/accept-invitation',
    loadComponent: () =>
      import('./features/auth/accept-invitation').then((m) => m.AcceptInvitationPage),
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
        path: 'content/:uid/configure-view',
        loadComponent: () =>
          import('./features/content/edit-view-config').then((m) => m.EditViewConfigPage),
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
        path: 'releases',
        loadComponent: () => import('./features/releases/releases').then((m) => m.ReleasesPage),
      },
      {
        path: 'releases/:id',
        loadComponent: () =>
          import('./features/releases/release-detail').then((m) => m.ReleaseDetailPage),
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
        path: 'profile',
        loadComponent: () => import('./features/profile/profile').then((m) => m.ProfilePage),
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
        path: 'settings/audit-logs',
        loadComponent: () => import('./features/settings/audit-logs').then((m) => m.AuditLogsPage),
      },
      {
        path: 'settings/review-workflows',
        loadComponent: () =>
          import('./features/settings/review-workflows').then((m) => m.ReviewWorkflowsPage),
      },
      {
        path: 'settings/review-workflows/:id',
        loadComponent: () =>
          import('./features/settings/review-workflow-edit').then((m) => m.ReviewWorkflowEditPage),
      },
      {
        path: 'settings/plugins',
        loadComponent: () => import('./features/settings/plugins').then((m) => m.PluginsPage),
      },
      {
        path: 'settings/internationalization',
        loadComponent: () => import('./features/settings/locales').then((m) => m.LocalesPage),
      },
      {
        path: 'settings/end-users',
        pathMatch: 'full',
        redirectTo: 'settings/end-users/users',
      },
      {
        path: 'settings/end-users/users',
        loadComponent: () => import('./features/settings/end-users').then((m) => m.EndUsersPage),
      },
      {
        path: 'settings/end-users/roles',
        loadComponent: () =>
          import('./features/settings/end-user-roles').then((m) => m.EndUserRolesPage),
      },
      {
        path: 'settings/end-users/roles/:id',
        loadComponent: () =>
          import('./features/settings/end-user-role-edit').then((m) => m.EndUserRoleEditPage),
      },
      {
        path: 'settings/end-users/settings',
        loadComponent: () =>
          import('./features/settings/end-users-settings').then((m) => m.EndUsersSettingsPage),
      },
      {
        path: 'settings/public',
        loadComponent: () => import('./features/settings/public').then((m) => m.PublicPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
