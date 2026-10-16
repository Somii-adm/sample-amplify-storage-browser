import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import { AdminGetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';

const { grantList } = vi.hoisted(() => ({ grantList: vi.fn() }));

vi.mock('aws-amplify', () => ({ Amplify: { configure: vi.fn() } }));
vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({ models: { AccessGrant: { list: grantList } } }),
}));
vi.mock('@aws-amplify/backend/function/runtime', () => ({
  getAmplifyDataClientConfig: vi.fn(async () => ({ resourceConfig: {}, libraryOptions: {} })),
}));

const sts = mockClient(STSClient);
const cognito = mockClient(CognitoIdentityProviderClient);
const { handler } = await import('./handler');

const identity = { username: 'caller-id', groups: ['finance', 'engineering'] };
const userGrant = (overrides = {}) => ({
  bucketName: 'b',
  prefix: '',
  level: 'Read',
  granteeType: 'USER',
  grantee: 'user@example.com',
  status: 'Active',
  ...overrides,
});
const event = (fieldName: string, args = {}) => ({
  fieldName,
  arguments: { scope: 's3://b/*', permission: 'READ', ...args },
  identity,
});
const credentials = {
  AccessKeyId: 'access',
  SecretAccessKey: 'secret',
  SessionToken: 'token',
  Expiration: new Date('2030-01-01T00:00:00.000Z'),
};

describe('location-access handler', () => {
  beforeEach(() => {
    sts.reset();
    cognito.reset();
    grantList.mockReset().mockResolvedValue({ data: [] });
    cognito.on(AdminGetUserCommand).resolves({
      UserAttributes: [{ Name: 'email', Value: 'USER@EXAMPLE.COM' }],
    });
    sts.on(AssumeRoleCommand).resolves({ Credentials: credentials });
    process.env.USER_POOL_ID = 'pool';
    process.env.DATA_ROLE_ARN = 'arn:aws:iam::123456789012:role/data-role';
  });

  test('LA-01 matches a user grant by case-insensitive email', async () => {
    grantList.mockResolvedValue({ data: [userGrant()] });
    expect(await handler(event('myLocations') as never)).toMatchObject([{ bucket: 'b' }]);
  });

  test('LA-02 matches group grants using identity.groups', async () => {
    grantList.mockResolvedValue({ data: [userGrant({ granteeType: 'GROUP', grantee: 'finance' })] });
    expect(await handler(event('myLocations') as never)).toMatchObject([{ bucket: 'b' }]);
  });

  test('LA-03 returns grants for both of a user’s groups', async () => {
    grantList.mockResolvedValue({ data: [
      userGrant({ granteeType: 'GROUP', grantee: 'finance', bucketName: 'finance-bucket' }),
      userGrant({ granteeType: 'GROUP', grantee: 'engineering', bucketName: 'engineering-bucket' }),
    ] });
    expect(await handler(event('myLocations') as never)).toHaveLength(2);
  });

  test('LA-04 keeps the strongest grant for a duplicate location', async () => {
    grantList.mockResolvedValue({ data: [
      userGrant({ level: 'Read' }),
      userGrant({ level: 'Full', granteeType: 'GROUP', grantee: 'finance' }),
    ] });
    expect(await handler(event('myLocations') as never)).toMatchObject([{ permissions: ['get', 'list', 'write', 'delete'] }]);
  });

  test('LA-05 ignores revoked grants', async () => {
    const revokedGrant = userGrant({ status: 'Revoked' });
    grantList.mockImplementation(async ({ filter }) => ({
      data: [revokedGrant].filter((grant) => grant.status === filter.status.eq),
    }));
    expect(await handler(event('myLocations') as never)).toEqual([]);
    expect(grantList).toHaveBeenCalledWith(expect.objectContaining({
      filter: { status: { eq: 'Active' } },
    }));
  });

  test.each([
    ['Read', ['get', 'list']],
    ['ReadWrite', ['get', 'list', 'write']],
    ['Full', ['get', 'list', 'write', 'delete']],
  ])('LA-06 maps %s permissions correctly', async (level, permissions) => {
    grantList.mockResolvedValue({ data: [userGrant({ level })] });
    expect(await handler(event('myLocations') as never)).toMatchObject([{ permissions }]);
  });

  test('LA-07 denies credentials when no grant covers the bucket', async () => {
    await expect(handler(event('locationCredentials') as never)).rejects.toThrow('Access denied');
    expect(sts.calls()).toHaveLength(0);
  });

  test.each(['WRITE', 'READWRITE'])('LA-08 denies %s with a Read grant', async (permission) => {
    grantList.mockResolvedValue({ data: [userGrant()] });
    await expect(handler(event('locationCredentials', { permission }) as never)).rejects.toThrow('read-only');
    expect(sts.calls()).toHaveLength(0);
  });

  test('LA-09 allows a folder grant to its nested reports path', async () => {
    grantList.mockResolvedValue({ data: [userGrant({ prefix: 'reports/' })] });
    await expect(handler(event('locationCredentials', { scope: 's3://b/reports/2026/*' }) as never)).resolves.toMatchObject({
      accessKeyId: 'access',
    });
  });

  test('LA-10 denies a folder grant for a similarly prefixed path', async () => {
    grantList.mockResolvedValue({ data: [userGrant({ prefix: 'fin/' })] });
    await expect(handler(event('locationCredentials', { scope: 's3://b/finance/*' }) as never)).rejects.toThrow('Access denied');
  });

  test('LA-11 scopes object actions and ListBucket to a folder grant', async () => {
    grantList.mockResolvedValue({ data: [userGrant({ prefix: 'reports/' })] });
    await handler(event('locationCredentials', { scope: 's3://b/reports/*' }) as never);
    const policy = JSON.parse(sts.commandCalls(AssumeRoleCommand)[0].args[0].input.Policy!);
    expect(policy.Statement[0].Resource).toBe('arn:aws:s3:::b/reports/*');
    expect(policy.Statement[1].Condition.StringLike['s3:prefix']).toEqual(['reports/*']);
  });

  test('LA-12 omits the ListBucket prefix condition for a whole-bucket grant', async () => {
    grantList.mockResolvedValue({ data: [userGrant()] });
    await handler(event('locationCredentials') as never);
    const policy = JSON.parse(sts.commandCalls(AssumeRoleCommand)[0].args[0].input.Policy!);
    expect(policy.Statement[1]).not.toHaveProperty('Condition');
  });

  test('LA-13 excludes write and delete actions for a Read grant', async () => {
    grantList.mockResolvedValue({ data: [userGrant()] });
    await handler(event('locationCredentials') as never);
    const policy = JSON.parse(sts.commandCalls(AssumeRoleCommand)[0].args[0].input.Policy!);
    expect(policy.Statement[0].Action).not.toContain('s3:PutObject');
    expect(policy.Statement[0].Action).not.toContain('s3:DeleteObject');
  });

  test('LA-14 assumes the configured data role for 900 seconds', async () => {
    grantList.mockResolvedValue({ data: [userGrant()] });
    await handler(event('locationCredentials') as never);
    expect(sts.commandCalls(AssumeRoleCommand)[0].args[0].input).toMatchObject({
      RoleArn: process.env.DATA_ROLE_ARN,
      DurationSeconds: 900,
    });
  });

  test('LA-15 rejects unknown field names', async () => {
    await expect(handler(event('notAnOperation') as never)).rejects.toThrow('Unknown operation');
  });
});