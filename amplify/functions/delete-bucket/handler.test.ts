import { beforeEach, describe, expect, test, vi } from 'vitest';
import { DeleteBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { AdminGetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';

const { bucketUpdate, grantList, grantUpdate } = vi.hoisted(() => ({
  bucketUpdate: vi.fn(),
  grantList: vi.fn(),
  grantUpdate: vi.fn(),
}));

vi.mock('aws-amplify', () => ({ Amplify: { configure: vi.fn() } }));
vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      BucketRecord: { update: bucketUpdate },
      AccessGrant: { list: grantList, update: grantUpdate },
    },
  }),
}));
vi.mock('@aws-amplify/backend/function/runtime', () => ({
  getAmplifyDataClientConfig: vi.fn(async () => ({ resourceConfig: {}, libraryOptions: {} })),
}));

const s3 = mockClient(S3Client);
const cognito = mockClient(CognitoIdentityProviderClient);
const { handler } = await import('./handler');
const invoke = (input: unknown) =>
  handler(input as never, {} as never, (() => undefined) as never);

const event = (args = {}, groups = ['StorageAdmin'], username = 'caller-id') => ({
  arguments: { bucketName: 'zifotest-team-purpose-dev', region: 'ap-south-1', recordId: 'bucket-record', reason: 'approved cleanup', ...args },
  identity: { username, groups },
});

describe('delete-bucket handler', () => {
  beforeEach(() => {
    s3.reset();
    cognito.reset();
    bucketUpdate.mockReset().mockResolvedValue({});
    grantList.mockReset().mockResolvedValue({ data: [] });
    grantUpdate.mockReset().mockResolvedValue({});
    cognito.on(AdminGetUserCommand).resolves({
      UserAttributes: [{ Name: 'email', Value: 'admin@example.com' }],
    });
    process.env.USER_POOL_ID = 'pool';
  });

  test('DB-01 refuses a caller who is not a bucket manager', async () => {
    expect(await invoke(event({}, ['Auditor']))).toMatchObject({ success: false });
    expect(s3.calls()).toHaveLength(0);
  });

  test('DB-02 refuses non-portal bucket names without an S3 call', async () => {
    expect(await invoke(event({ bucketName: 'ordinary-bucket' }))).toMatchObject({ success: false });
    expect(s3.calls()).toHaveLength(0);
  });

  test('DB-03 refuses reasons shorter than five characters', async () => {
    expect(await invoke(event({ reason: 'no' }))).toMatchObject({ success: false });
    expect(s3.calls()).toHaveLength(0);
  });

  test('DB-04 returns the friendly not-empty message and leaves the record unchanged', async () => {
    s3.on(DeleteBucketCommand).rejects(Object.assign(new Error('not empty'), { name: 'BucketNotEmpty' }));
    expect(await invoke(event())).toMatchObject({ success: false, message: expect.stringContaining('not empty') });
    expect(bucketUpdate).not.toHaveBeenCalled();
  });

  test('DB-05 marks the record Deleted when S3 reports NoSuchBucket', async () => {
    s3.on(DeleteBucketCommand).rejects(Object.assign(new Error('missing'), { name: 'NoSuchBucket' }));
    expect(await invoke(event())).toMatchObject({ success: true });
    expect(bucketUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 'bucket-record', status: 'Deleted' }));
  });

  test('DB-06 updates the record and revokes each active grant after deletion', async () => {
    grantList.mockResolvedValue({ data: [{ id: 'grant-1' }, { id: 'grant-2' }] });
    const result = await invoke(event());
    expect(result).toMatchObject({ success: true });
    expect(bucketUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: 'bucket-record',
      status: 'Deleted',
      deletedBy: 'admin@example.com',
      deleteReason: 'approved cleanup',
      deletedAt: expect.any(String),
    }));
    expect(grantUpdate).toHaveBeenCalledTimes(2);
    expect(grantUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: 'grant-1',
      status: 'Revoked',
      revokedBy: 'admin@example.com',
      revokedAt: expect.any(String),
    }));
  });
});