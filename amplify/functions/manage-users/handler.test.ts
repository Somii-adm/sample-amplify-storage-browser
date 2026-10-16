import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminGetUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  ListUsersInGroupCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';

const { roleChangeCreate } = vi.hoisted(() => ({ roleChangeCreate: vi.fn() }));

vi.mock('aws-amplify', () => ({ Amplify: { configure: vi.fn() } }));
vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({ models: { RoleChange: { create: roleChangeCreate } } }),
}));
vi.mock('@aws-amplify/backend/function/runtime', () => ({
  getAmplifyDataClientConfig: vi.fn(async () => ({ resourceConfig: {}, libraryOptions: {} })),
}));

const cognito = mockClient(CognitoIdentityProviderClient);
const { handler } = await import('./handler');
const caller = { username: 'admin-id', groups: ['SuperAdmin'] };
const event = (fieldName: string, args = {}, identity = caller) => ({
  fieldName,
  arguments: args,
  identity,
});
const createArgs = (overrides = {}) => ({
  email: 'New.User@Example.com',
  roles: ['BusinessUser'],
  reason: 'onboarding request',
  ...overrides,
});
const user = (Username: string, email: string, extra: Partial<UserType> = {}): UserType => ({
  Username,
  Attributes: [{ Name: 'email', Value: email }],
  Enabled: true,
  UserStatus: 'CONFIRMED' as const,
  UserCreateDate: new Date('2025-01-01T00:00:00.000Z'),
  ...extra,
});

describe('manage-users handler', () => {
  beforeEach(() => {
    cognito.reset();
    roleChangeCreate.mockReset().mockResolvedValue({});
    cognito.on(AdminGetUserCommand).resolves({
      UserAttributes: [{ Name: 'email', Value: 'admin@example.com' }],
    });
    cognito.on(ListUsersCommand).resolves({ Users: [] });
    cognito.on(ListUsersInGroupCommand).resolves({ Users: [] });
    process.env.USER_POOL_ID = 'pool';
  });

  test('MU-01 throws when a non-SuperAdmin lists users', async () => {
    await expect(handler(event('listPortalUsers', {}, { username: 'reader', groups: ['StorageAdmin'] }) as never))
      .rejects.toThrow('not allowed');
    expect(cognito.calls()).toHaveLength(0);
  });

  test('MU-02 rejects missing roles, unknown roles, invalid email, and short reason', async () => {
    for (const args of [
      createArgs({ roles: [] }),
      createArgs({ roles: ['UnknownRole'] }),
      createArgs({ email: 'invalid' }),
      createArgs({ reason: 'no' }),
    ]) {
      expect(await handler(event('createPortalUser', args) as never)).toMatchObject({ success: false });
    }
    expect(cognito.commandCalls(AdminCreateUserCommand)).toHaveLength(0);
  });

  test('MU-03 creates the user, assigns each role, and records the change', async () => {
    cognito.on(AdminCreateUserCommand).resolves({ User: { Username: 'cognito-new-user' } });
    const result = await handler(event('createPortalUser', createArgs({ roles: ['BusinessUser', 'finance'] })) as never);
    expect(result).toMatchObject({ success: true, temporaryPassword: expect.any(String) });
    expect(cognito.commandCalls(AdminCreateUserCommand)[0].args[0].input).toMatchObject({
      MessageAction: 'SUPPRESS',
      UserAttributes: expect.arrayContaining([
        { Name: 'email', Value: 'new.user@example.com' },
        { Name: 'email_verified', Value: 'true' },
      ]),
    });
    expect(cognito.commandCalls(AdminAddUserToGroupCommand)).toHaveLength(2);
    expect(roleChangeCreate).toHaveBeenCalledWith(expect.objectContaining({
      targetEmail: 'new.user@example.com',
      action: 'CreateUser',
      performedBy: 'admin@example.com',
    }));
  });

  test('MU-04 temporary passwords meet Cognito length and character-class rules', async () => {
    cognito.on(AdminCreateUserCommand).resolves({ User: { Username: 'cognito-new-user' } });
    const result = await handler(event('createPortalUser', createArgs()) as never);
    if (!('temporaryPassword' in result) || typeof result.temporaryPassword !== 'string') {
      throw new Error('Expected a temporary password');
    }
    const password = result.temporaryPassword;
    expect(password.length).toBeGreaterThanOrEqual(14);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[^A-Za-z0-9]/);
  });

  test('MU-05 returns a friendly message for an existing email', async () => {
    cognito.on(AdminCreateUserCommand).rejects(Object.assign(new Error('exists'), { name: 'UsernameExistsException' }));
    expect(await handler(event('createPortalUser', createArgs()) as never)).toMatchObject({
      success: false,
      message: expect.stringContaining('already exists'),
    });
  });

  test('MU-06 refuses removing the caller’s own SuperAdmin role', async () => {
    expect(await handler(event('setUserRole', {
      username: 'admin-id', role: 'SuperAdmin', add: false, reason: 'role change request',
    }) as never)).toMatchObject({ success: false, message: expect.stringContaining('own SuperAdmin') });
    expect(cognito.commandCalls(AdminRemoveUserFromGroupCommand)).toHaveLength(0);
  });

  test('MU-07 refuses removing the last active SuperAdmin role', async () => {
    cognito.on(ListUsersInGroupCommand).resolves({ Users: [{ Username: 'other-super', Enabled: true }] });
    expect(await handler(event('setUserRole', {
      username: 'other-super', role: 'SuperAdmin', add: false, reason: 'role change request',
    }) as never)).toMatchObject({ success: false, message: expect.stringContaining('At least one active SuperAdmin') });
    expect(cognito.commandCalls(AdminRemoveUserFromGroupCommand)).toHaveLength(0);
  });

  test('MU-08 refuses disabling the caller’s own account', async () => {
    expect(await handler(event('setUserEnabled', {
      username: 'admin-id', enabled: false, reason: 'account no longer needed',
    }) as never)).toMatchObject({ success: false, message: expect.stringContaining('own account') });
    expect(cognito.commandCalls(AdminDisableUserCommand)).toHaveLength(0);
  });

  test('MU-09 refuses disabling the last active SuperAdmin', async () => {
    cognito.on(ListUsersInGroupCommand).resolves({ Users: [{ Username: 'other-super', Enabled: true }] });
    expect(await handler(event('setUserEnabled', {
      username: 'other-super', enabled: false, reason: 'account no longer needed',
    }) as never)).toMatchObject({ success: false, message: expect.stringContaining('last active SuperAdmin') });
    expect(cognito.commandCalls(AdminDisableUserCommand)).toHaveLength(0);
  });

  test('MU-10 disables and signs out another user, and records the change', async () => {
    cognito.on(AdminUserGlobalSignOutCommand).resolves({});
    expect(await handler(event('setUserEnabled', {
      username: 'business-user', enabled: false, reason: 'account no longer needed',
    }) as never)).toMatchObject({ success: true });
    expect(cognito.commandCalls(AdminDisableUserCommand)).toHaveLength(1);
    expect(cognito.commandCalls(AdminUserGlobalSignOutCommand)).toHaveLength(1);
    expect(roleChangeCreate).toHaveBeenCalledWith(expect.objectContaining({
      targetEmail: 'admin@example.com',
      action: 'DisableUser',
      performedBy: 'admin@example.com',
    }));
  });

  test('MU-11 combines group memberships and sorts portal users by email', async () => {
    cognito.on(ListUsersCommand).resolves({
      Users: [user('user-z', 'z@example.com'), user('user-a', 'a@example.com')],
    });
    cognito.on(ListUsersInGroupCommand, { GroupName: 'BusinessUser' }).resolves({
      Users: [{ Username: 'user-z' }],
    });
    cognito.on(ListUsersInGroupCommand, { GroupName: 'finance' }).resolves({
      Users: [{ Username: 'user-z' }],
    });
    const users = await handler(event('listPortalUsers') as never);
    expect(users).toMatchObject([
      { username: 'user-a', email: 'a@example.com', groups: [] },
      { username: 'user-z', email: 'z@example.com', groups: ['BusinessUser', 'finance'] },
    ]);
  });
});