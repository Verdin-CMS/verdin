import { Routes } from '@angular/router';

import { requireAccess } from './core/access';
import { authGuard, guestGuard } from './core/auth';
import { unsavedChangesGuard } from './shared/components/confirm';

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
    canActivateChild: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', loadComponent: () => import('./features/home').then((m) => m.HomePage) },
      {
        path: 'content/:uid',
        loadComponent: () => import('./features/content/list').then((m) => m.ContentList),
      },
      {
        path: 'content/:uid/new',
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./features/content/edit').then((m) => m.ContentEdit),
      },
      {
        path: 'content/:uid/configure-view',
        canMatch: [requireAccess({ permission: 'views.manage' })],
        loadComponent: () =>
          import('./features/content/edit-view-config').then((m) => m.EditViewConfigPage),
      },
      {
        path: 'content/:uid/:documentId',
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./features/content/edit').then((m) => m.ContentEdit),
      },
      {
        path: 'content/:uid/:documentId/history',
        loadComponent: () => import('./features/content/history').then((m) => m.ContentHistory),
      },
      {
        path: 'single/:uid',
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./features/content/edit').then((m) => m.ContentEdit),
      },
      {
        path: 'media',
        canMatch: [requireAccess({ permission: 'media.read' })],
        loadComponent: () => import('./features/media/library').then((m) => m.MediaLibraryPage),
      },
      {
        path: 'releases',
        canMatch: [requireAccess({ permission: 'releases.manage' })],
        loadComponent: () => import('./features/releases/releases').then((m) => m.ReleasesPage),
      },
      {
        path: 'releases/:id',
        canMatch: [requireAccess({ permission: 'releases.manage', feature: 'releases' })],
        loadComponent: () =>
          import('./features/releases/release-detail').then((m) => m.ReleaseDetailPage),
      },
      {
        path: 'builder',
        canMatch: [requireAccess({ permission: 'schema.manage' })],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./features/builder/builder').then((m) => m.Builder),
      },
      {
        path: 'builder/:name',
        canMatch: [requireAccess({ permission: 'schema.manage' })],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./features/builder/builder').then((m) => m.Builder),
      },
      {
        path: 'profile',
        loadComponent: () => import('./features/profile/profile').then((m) => m.ProfilePage),
      },
      {
        path: 'settings/users',
        canMatch: [requireAccess({ permission: 'users.manage' })],
        loadComponent: () => import('./features/settings/users').then((m) => m.UsersPage),
      },
      {
        path: 'settings/roles',
        canMatch: [requireAccess({ permission: 'roles.manage' })],
        loadComponent: () => import('./features/settings/roles').then((m) => m.RolesPage),
      },
      {
        path: 'settings/tokens',
        canMatch: [requireAccess({ permission: 'tokens.manage' })],
        loadComponent: () => import('./features/settings/tokens').then((m) => m.TokensPage),
      },
      {
        path: 'settings/features',
        canMatch: [requireAccess({ permission: 'features.manage' })],
        loadComponent: () => import('./features/settings/features').then((m) => m.FeaturesPage),
      },
      {
        path: 'settings/webhooks',
        canMatch: [requireAccess({ permission: 'webhooks.manage' })],
        loadComponent: () => import('./features/settings/webhooks').then((m) => m.WebhooksPage),
      },
      {
        path: 'settings/webhooks/:id',
        canMatch: [requireAccess({ permission: 'webhooks.manage', feature: 'webhooks' })],
        loadComponent: () =>
          import('./features/settings/webhook-edit').then((m) => m.WebhookEditPage),
      },
      {
        path: 'settings/audit-logs',
        canMatch: [requireAccess({ permission: 'audit.read' })],
        loadComponent: () => import('./features/settings/audit-logs').then((m) => m.AuditLogsPage),
      },
      {
        path: 'settings/review-workflows',
        canMatch: [requireAccess({ permission: 'workflows.manage' })],
        loadComponent: () =>
          import('./features/settings/review-workflows').then((m) => m.ReviewWorkflowsPage),
      },
      {
        path: 'settings/review-workflows/:id',
        canMatch: [requireAccess({ permission: 'workflows.manage' })],
        loadComponent: () =>
          import('./features/settings/review-workflow-edit').then((m) => m.ReviewWorkflowEditPage),
      },
      {
        path: 'settings/plugins',
        canMatch: [requireAccess({ permission: 'plugins.manage' })],
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
        canMatch: [requireAccess({ permission: 'endusers.manage' })],
        loadComponent: () => import('./features/settings/end-users').then((m) => m.EndUsersPage),
      },
      {
        path: 'settings/end-users/roles',
        canMatch: [requireAccess({ permission: 'endusers.manage' })],
        loadComponent: () =>
          import('./features/settings/end-user-roles').then((m) => m.EndUserRolesPage),
      },
      {
        path: 'settings/end-users/roles/:id',
        canMatch: [requireAccess({ permission: 'endusers.manage' })],
        loadComponent: () =>
          import('./features/settings/end-user-role-edit').then((m) => m.EndUserRoleEditPage),
      },
      {
        path: 'settings/end-users/settings',
        canMatch: [requireAccess({ permission: 'endusers.manage' })],
        loadComponent: () =>
          import('./features/settings/end-users-settings').then((m) => m.EndUsersSettingsPage),
      },
      {
        path: 'settings/deployments',
        canMatch: [requireAccess({ permission: 'deploy.manage' })],
        loadComponent: () =>
          import('./features/settings/deployments').then((m) => m.DeploymentsPage),
      },
      {
        path: 'settings/redirects',
        canMatch: [requireAccess({ permission: 'site.manage' })],
        loadComponent: () => import('./features/settings/redirects').then((m) => m.RedirectsPage),
      },
      {
        path: 'settings/menus',
        canMatch: [requireAccess({ permission: 'site.manage' })],
        loadComponent: () => import('./features/settings/menus').then((m) => m.MenusPage),
      },
      {
        path: 'settings/menus/:id',
        canMatch: [requireAccess({ permission: 'site.manage' })],
        loadComponent: () => import('./features/settings/menu-edit').then((m) => m.MenuEditPage),
      },
      {
        path: 'settings/forms',
        canMatch: [requireAccess({ permission: 'site.manage' })],
        loadComponent: () => import('./features/settings/forms').then((m) => m.FormsPage),
      },
      {
        path: 'settings/forms/:id',
        canMatch: [requireAccess({ permission: 'site.manage' })],
        loadComponent: () => import('./features/settings/form-edit').then((m) => m.FormEditPage),
      },
      {
        path: 'settings/public',
        canMatch: [requireAccess({ permission: 'roles.manage' })],
        loadComponent: () => import('./features/settings/public').then((m) => m.PublicPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
