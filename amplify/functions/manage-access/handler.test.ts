import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AdminGetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';

const { bucketList, grantList, grantCreate, grantGet, grantUpdate } = vi.hoisted(() => ({
  bucketList: vi.fn(),
  grantList: vi.fn(),
  grantCreate: vi.fn(),
  grantGet: vi.fn(),
  grantUpdate: vi.fn(),
}));

vi.mock('aws-amplify', () => ({ Amplify: { configure: vi.fn() } }));
vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      BucketRecord: { list: bucketList },
      AccessGrant: { list: grantList, create: grantCreate, get: grantGet, update: grantUpdate },
    },
  }),
}));
vi.mock('@aws-amplify/backend/function/runtime', () => ({
  getAmplifyDataClientConfig: vi.fn(async () => ({ resourceConfig: {}, libraryOptions: {} })),
}));

const cognito = mockClient(CognitoIdentityProviderClient);
const { handler } = await import('./handler');
const caller = { username: 'admin-id', groups: ['SecurityAdmin'] };
const grantArgs = (overrides = {}) => ({
  bucketName: 'zifotest-team-purpose-dev',
  granteeType: 'USER',
  grantee: 'person@example.com',
  prefix: '',
  level: 'Read',
  reason: 'business need',
  ...overrides,
});
const event = (fieldName: string, args = {}, groups = caller.groups) => ({
  fieldName,
  arguments: args,
  identity: { ...caller, groups },
});

describe('manage-access handler', () => {
  beforeEach(() => {
    cognito.reset();
    bucketList.mockReset().mockResolvedValue({ data: [{ status: 'Active' }] });
    grantList.mockReset().mockResolvedValue({ data: [] });
    grantCreate.mockReset().mockResolvedValue({});
    grantGet.mockReset().mockResolvedValue({ data: null });
    grantUpdate.mockReset().mockResolvedValue({});
    cognito.on(AdminGetUserCommand).resolves({
      UserAttributes: [{ Name: 'email', Value: 'admin@example.com' }],
    });
    process.env.USER_POOL_ID = 'pool';
  });

  test('MA-01 refuses a caller without an access-manager role', async () => {
    expect(await handler(event('grantAccess', grantArgs(), ['Auditor']) as never)).toMatchObject({ success: false });
    expect(bucketList).not.toHaveBeenCalled();
  });

  test('MA-02 refuses a grant to the caller’s own email', async () => {
    expect(await handler(event('grantAccess', grantArgs({ grantee: 'ADMIN@EXAMPLE.COM' })) as never))
      .toMatchObject({ success: false, message: expect.stringContaining('Ask another admin') });
    expect(bucketList).not.toHaveBeenCalled();
  });

  test('MA-03 refuses unknown groups, invalid emails, and unknown levels', async () => {
    for (const args of [
      grantArgs({ granteeType: 'GROUP', grantee: 'unknown-group' }),
      grantArgs({ grantee: 'not-an-email' }),
      grantArgs({ level: 'Admin' }),
    ]) {
      expect(await handler(event('grantAccess', args) as never)).toMatchObject({ success: false });
    }
    expect(bucketList).not.toHaveBeenCalled();
  });

  test('MA-04 normalizes folder names and leading/trailing slashes', async () => {
    await handler(event('grantAccess', grantArgs({ prefix: 'reports' })) as never);
    expect(grantCreate).toHaveBeenLastCalledWith(expect.objectContaining({ prefix: 'reports/' }));
    grantCreate.mockClear();
    await handler(event('grantAccess', grantArgs({ prefix: '/reports/' })) as never);
    expect(grantCreate).toHaveBeenLastCalledWith(expect.objectContaining({ prefix: 'reports/' }));
  });

  test('MA-05 refuses folder paths containing traversal or wildcard characters', async () => {
    for (const prefix of ['reports/../private', 'reports/*']) {
      expect(await handler(event('grantAccess', grantArgs({ prefix })) as never)).toMatchObject({ success: false });
    }
    expect(bucketList).not.toHaveBeenCalled();
  });

  test('MA-06 refuses missing and deleted portal bucket records', async () => {
    bucketList.mockResolvedValueOnce({ data: [] }).mockResolvedValueOnce({ data: [{ status: 'Deleted' }] });
    for (let i = 0; i < 2; i++) {
      expect(await handler(event('grantAccess', grantArgs()) as never)).toMatchObject({ success: false });
    }
    expect(grantCreate).not.toHaveBeenCalled();
  });

  test('MA-07 refuses a duplicate active grant with its current level in the message', async () => {
    grantList.mockResolvedValue({ data: [{
      prefix: '',
      granteeType: 'USER',
      grantee: 'person@example.com',
      level: 'Full',
    }] });
    expect(await handler(event('grantAccess', grantArgs()) as never)).toMatchObject({
      success: false,
      message: expect.stringContaining('Full'),
    });
    expect(grantCreate).not.toHaveBeenCalled();
  });

  test('MA-08 creates a valid active grant attributed to the caller email', async () => {
    expect(await handler(event('grantAccess', grantArgs()) as never)).toMatchObject({ success: true });
    expect(grantCreate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'Active',
      grantedBy: 'admin@example.com',
      level: 'Read',
    }));
  });

  test('MA-09 revokes an active grant and refuses an already-revoked grant', async () => {
    grantGet.mockResolvedValue({ data: {
      id: 'grant-id',
      status: 'Active',
      grantee: 'person@example.com',
      bucketName: 'zifotest-team-purpose-dev',
      prefix: 'reports/',
    } });
    expect(await handler(event('revokeAccess', { grantId: 'grant-id', reason: 'contract ended' }) as never))
      .toMatchObject({ success: true });
    expect(grantUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: 'grant-id',
      status: 'Revoked',
      revokedBy: 'admin@example.com',
      revokedAt: expect.any(String),
      revokeReason: 'contract ended',
    }));
    grantGet.mockResolvedValue({ data: { id: 'grant-id', status: 'Revoked' } });
    expect(await handler(event('revokeAccess', { grantId: 'grant-id', reason: 'contract ended' }) as never))
      .toMatchObject({ success: false, message: expect.stringContaining('already revoked') });
  });
});