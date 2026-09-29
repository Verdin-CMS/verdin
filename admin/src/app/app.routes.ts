import { Routes } from '@angular/router';

import { requireAccess } from './core/access';
import { authGuard, guestGuard } from './core/auth';
import { titled } from './core/title';
import { unsavedChangesGuard } from './shared/components/confirm';

export const routes: Routes = [
  {
    path: 'login',
    ...titled({ page: 'title.login' }),
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    ...titled({ page: 'title.register' }),
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/register').then((m) => m.RegisterPage),
  },
  {
    path: 'auth/forgot-password',
    ...titled({ page: 'title.forgotPassword' }),
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/forgot-password').then((m) => m.ForgotPasswordPage),
  },
  {
    path: 'auth/reset-password',
    ...titled({ page: 'title.resetPassword' }),
    loadComponent: () => import('./features/auth/reset-password').then((m) => m.ResetPasswordPage),
  },
  {
    path: 'auth/accept-invitation',
    ...titled({ page: 'title.acceptInvitation' }),
    loadComponent: () =>
      import('./features/auth/accept-invitation').then((m) => m.AcceptInvitationPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      {
        path: '',
        ...titled({ page: 'shell.home' }),
        loadComponent: () => import('./features/home').then((m) => m.HomePage),
      },
      {
        path: 'content/:uid',
        ...titled({ type: true, sections: ['title.content'] }),
        loadComponent: () => import('./features/content/list').then((m) => m.ContentList),
      },
      {
        path: 'content/:uid/new',
        ...titled({ page: 'title.newEntry', type: true, sections: ['title.content'] }),
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./features/content/edit').then((m) => m.ContentEdit),
      },
      {
        path: 'content/:uid/configure-view',
        ...titled({ page: 'content.view.title', type: true, sections: ['title.content'] }),
        canMatch: [requireAccess({ permission: 'views.manage' })],
        loadComponent: () =>
          import('./features/content/edit-view-config').then((m) => m.EditViewConfigPage),
      },
      {
        path: 'content/:uid/:documentId',
        ...titled({ detail: 'title.entry', type: true, sections: ['title.content'] }),
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./features/content/edit').then((m) => m.ContentEdit),
      },
      {
        path: 'content/:uid/:documentId/history',
        ...titled({ page: 'content.history.title', type: true, sections: ['title.content'] }),
        loadComponent: () => import('./features/content/history').then((m) => m.ContentHistory),
      },
      {
        path: 'single/:uid',
        ...titled({ type: true, sections: ['title.content'] }),
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./features/content/edit').then((m) => m.ContentEdit),
      },
      {
        path: 'media',
        ...titled({ page: 'media.title' }),
        canMatch: [requireAccess({ permission: 'media.read' })],
        loadComponent: () => import('./features/media/library').then((m) => m.MediaLibraryPage),
      },
      {
        path: 'releases',
        ...titled({ page: 'shell.releases' }),
        canMatch: [requireAccess({ permission: 'releases.manage' })],
        loadComponent: () => import('./features/releases/releases').then((m) => m.ReleasesPage),
      },
      {
        path: 'releases/:id',
        ...titled({ detail: 'title.release', sections: ['shell.releases'] }),
        canMatch: [requireAccess({ permission: 'releases.manage', feature: 'releases' })],
        loadComponent: () =>
          import('./features/releases/release-detail').then((m) => m.ReleaseDetailPage),
      },
      {
        path: 'builder',
        ...titled({ page: 'shell.builder' }),
        canMatch: [requireAccess({ permission: 'schema.manage' })],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./features/builder/builder').then((m) => m.Builder),
      },
      {
        path: 'builder/:name',
        ...titled({ page: 'shell.builder' }),
        canMatch: [requireAccess({ permission: 'schema.manage' })],
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./features/builder/builder').then((m) => m.Builder),
      },
      {
        path: 'profile',
        ...titled({ page: 'account.menu' }),
        loadComponent: () => import('./features/profile/profile').then((m) => m.ProfilePage),
      },
      {
        path: 'settings/users',
        ...titled({ page: 'shell.users', sections: ['shell.settings'] }),
        canMatch: [requireAccess({ permission: 'users.manage' })],
        loadComponent: () => import('./features/settings/users').then((m) => m.UsersPage),
      },
      {
        path: 'settings/roles',
        ...titled({ page: 'shell.roles', sections: ['shell.settings'] }),
        canMatch: [requireAccess({ permission: 'roles.manage' })],
        loadComponent: () => import('./features/settings/roles').then((m) => m.RolesPage),
      },
      {
        path: 'settings/tokens',
        ...titled({ page: 'shell.apiTokens', sections: ['shell.settings'] }),
        canMatch: [requireAccess({ permission: 'tokens.manage' })],
        loadComponent: () => import('./features/settings/tokens').then((m) => m.TokensPage),
      },
      {
        path: 'settings/features',
        ...titled({ page: 'shell.features', sections: ['shell.settings'] }),
        canMatch: [requireAccess({ permission: 'features.manage' })],
        loadComponent: () => import('./features/settings/features').then((m) => m.FeaturesPage),
      },
      {
        path: 'settings/webhooks',
        ...titled({ page: 'shell.webhooks', sections: ['shell.settings'] }),
        canMatch: [requireAccess({ permission: 'webhooks.manage' })],
        loadComponent: () => import('./features/settings/webhooks').then((m) => m.WebhooksPage),
      },
      {
        path: 'settings/webhooks/:id',
        ...titled({ detail: 'title.edit', sections: ['shell.webhooks', 'shell.settings'] }),
        canMatch: [requireAccess({ permission: 'webhooks.manage', feature: 'webhooks' })],
        loadComponent: () =>
          import('./features/settings/webhook-edit').then((m) => m.WebhookEditPage),
      },
      {
        path: 'settings/audit-logs',
        ...titled({ page: 'shell.auditLogs', sections: ['shell.settings'] }),
        canMatch: [requireAccess({ permission: 'audit.read' })],
        loadComponent: () => import('./features/settings/audit-logs').then((m) => m.AuditLogsPage),
      },
      {
        path: 'settings/review-workflows',
        ...titled({ page: 'shell.reviewWorkflows', sections: ['shell.settings'] }),
        canMatch: [requireAccess({ permission: 'workflows.manage' })],
        loadComponent: () =>
          import('./features/settings/review-workflows').then((m) => m.ReviewWorkflowsPage),
      },
      {
        path: 'settings/review-workflows/:id',
        ...titled({ detail: 'title.edit', sections: ['shell.reviewWorkflows', 'shell.settings'] }),
        canMatch: [requireAccess({ permission: 'workflows.manage' })],
        loadComponent: () =>
          import('./features/settings/review-workflow-edit').then((m) => m.ReviewWorkflowEditPage),
      },
      {
        path: 'settings/plugins',
        ...titled({ page: 'shell.plugins', sections: ['shell.settings'] }),
        canMatch: [requireAccess({ permission: 'plugins.manage' })],
        loadComponent: () => import('./features/settings/plugins').then((m) => m.PluginsPage),
      },
      {
        path: 'settings/internationalization',
        ...titled({ page: 'shell.locales', sections: ['shell.settings'] }),
        loadComponent: () => import('./features/settings/locales').then((m) => m.LocalesPage),
      },
      {
        path: 'settings/end-users',
        pathMatch: 'full',
        redirectTo: 'settings/end-users/users',
      },
      {
        path: 'settings/end-users/users',
        ...titled({ page: 'endUsers.tab.users', sections: ['shell.endUsers', 'shell.settings'] }),
        canMatch: [requireAccess({ permission: 'endusers.manage' })],
        loadComponent: () => import('./features/settings/end-users').then((m) => m.EndUsersPage),
      },
      {
        path: 'settings/end-users/roles',
        ...titled({ page: 'endUsers.tab.roles', sections: ['shell.endUsers', 'shell.settings'] }),
        canMatch: [requireAccess({ permission: 'endusers.manage' })],
        loadComponent: () =>
          import('./features/settings/end-user-roles').then((m) => m.EndUserRolesPage),
      },
      {
        path: 'settings/end-users/roles/:id',
        ...titled({
          detail: 'title.edit',
          sections: ['endUsers.tab.roles', 'shell.endUsers', 'shell.settings'],
        }),
        canMatch: [requireAccess({ permission: 'endusers.manage' })],
        loadComponent: () =>
          import('./features/settings/end-user-role-edit').then((m) => m.EndUserRoleEditPage),
      },
      {
        path: 'settings/end-users/settings',
        ...titled({
          page: 'endUsers.tab.settings',
          sections: ['shell.endUsers', 'shell.settings'],
        }),
        canMatch: [requireAccess({ permission: 'endusers.manage' })],
        loadComponent: () =>
          import('./features/settings/end-users-settings').then((m) => m.EndUsersSettingsPage),
      },
      {
        path: 'settings/deployments',
        ...titled({ page: 'shell.deployments', sections: ['shell.settings'] }),
        canMatch: [requireAccess({ permission: 'deploy.manage' })],
        loadComponent: () =>
          import('./features/settings/deployments').then((m) => m.DeploymentsPage),
      },
      {
        path: 'settings/redirects',
        ...titled({ page: 'shell.redirects', sections: ['shell.settings'] }),
        canMatch: [requireAccess({ permission: 'site.manage' })],
        loadComponent: () => import('./features/settings/redirects').then((m) => m.RedirectsPage),
      },
      {
        path: 'settings/menus',
        ...titled({ page: 'shell.menus', sections: ['shell.settings'] }),
        canMatch: [requireAccess({ permission: 'site.manage' })],
        loadComponent: () => import('./features/settings/menus').then((m) => m.MenusPage),
      },
      {
        path: 'settings/menus/:id',
        ...titled({ detail: 'title.edit', sections: ['shell.menus', 'shell.settings'] }),
        canMatch: [requireAccess({ permission: 'site.manage' })],
        loadComponent: () => import('./features/settings/menu-edit').then((m) => m.MenuEditPage),
      },
      {
        path: 'settings/forms',
        ...titled({ page: 'shell.forms', sections: ['shell.settings'] }),
        canMatch: [requireAccess({ permission: 'site.manage' })],
        loadComponent: () => import('./features/settings/forms').then((m) => m.FormsPage),
      },
      {
        path: 'settings/forms/:id',
        ...titled({ detail: 'title.edit', sections: ['shell.forms', 'shell.settings'] }),
        canMatch: [requireAccess({ permission: 'site.manage' })],
        loadComponent: () => import('./features/settings/form-edit').then((m) => m.FormEditPage),
      },
      {
        path: 'settings/public',
        ...titled({ page: 'shell.publicAccess', sections: ['shell.settings'] }),
        canMatch: [requireAccess({ permission: 'roles.manage' })],
        loadComponent: () => import('./features/settings/public').then((m) => m.PublicPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
