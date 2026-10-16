import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  CreateBucketCommand,
  DeleteBucketCommand,
  PutBucketCorsCommand,
  PutBucketEncryptionCommand,
  PutBucketTaggingCommand,
  PutBucketVersioningCommand,
  PutPublicAccessBlockCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AdminGetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';
import { env } from '../test-env';

const { bucketCreate, grantCreate } = vi.hoisted(() => ({
  bucketCreate: vi.fn(),
  grantCreate: vi.fn(),
}));

vi.mock('aws-amplify', () => ({ Amplify: { configure: vi.fn() } }));
vi.mock('aws-amplify/data', () => ({
  generateClient: () => ({
    models: {
      BucketRecord: { create: bucketCreate },
      AccessGrant: { create: grantCreate },
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
const callsFor = (command: new (...args: never[]) => object) =>
  s3.calls().filter((call) => call.args[0] instanceof command);

const event = (args = {}, groups = ['StorageAdmin']) => ({
  arguments: {
    bucketName: 'zifotest-team-purpose-dev',
    region: 'ap-south-1',
    owner: 'Owner@Example.com',
    costCenter: 'CC1',
    businessUnit: 'Finance',
    classification: 'Internal',
    ...args,
  },
  identity: { username: 'caller-id', groups },
});

describe('create-bucket handler', () => {
  beforeEach(() => {
    s3.reset();
    cognito.reset();
    bucketCreate.mockReset().mockResolvedValue({});
    grantCreate.mockReset().mockResolvedValue({});
    cognito.on(AdminGetUserCommand).resolves({
      UserAttributes: [{ Name: 'email', Value: 'admin@example.com' }],
    });
    process.env.USER_POOL_ID = 'pool';
    env.PORTAL_ORIGINS = 'https://one.example.com,https://two.example.com';
  });

  test('CB-01 refuses callers without a bucket-manager role without contacting S3', async () => {
    const result = await invoke(event({}, ['Auditor']));
    expect(result).toMatchObject({ success: false });
    expect(s3.calls()).toHaveLength(0);
  });

  test('CB-02 rejects invalid names before contacting S3', async () => {
    for (const bucketName of ['bucket1', 'Zifotest-a-b-dev', 'zifotest-a-b']) {
      expect(await invoke(event({ bucketName }))).toMatchObject({ success: false, message: expect.stringContaining('Name') });
    }
    expect(s3.calls()).toHaveLength(0);
  });

  test('CB-03 rejects unsupported regions', async () => {
    expect(await invoke(event({ region: 'us-east-1' }))).toMatchObject({
      success: false,
      message: expect.stringContaining('Region'),
    });
    expect(s3.calls()).toHaveLength(0);
  });

  test('CB-04 rejects classifications outside the allowed list', async () => {
    expect(await invoke(event({ classification: 'Secret' }))).toMatchObject({
      success: false,
      message: expect.stringContaining('Classification'),
    });
    expect(s3.calls()).toHaveLength(0);
  });

  test('CB-05 rejects an owner without an at sign', async () => {
    expect(await invoke(event({ owner: 'not-an-email' }))).toMatchObject({
      success: false,
      message: expect.stringContaining('Owner'),
    });
    expect(s3.calls()).toHaveLength(0);
  });

  test('CB-06 creates the guarded bucket and saves its record and owner grant', async () => {
    const result = await invoke(event());
    expect(result).toMatchObject({ success: true });
    for (const command of [
      CreateBucketCommand,
      PutPublicAccessBlockCommand,
      PutBucketEncryptionCommand,
      PutBucketVersioningCommand,
      PutBucketTaggingCommand,
      PutBucketCorsCommand,
    ]) {
      expect(callsFor(command)).toHaveLength(1);
    }
    expect(s3.commandCalls(PutBucketEncryptionCommand)[0].args[0].input).toMatchObject({
      ServerSideEncryptionConfiguration: {
        Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'aws:kms' }, BucketKeyEnabled: true }],
      },
    });
    expect(s3.commandCalls(PutBucketVersioningCommand)[0].args[0].input.VersioningConfiguration?.Status).toBe('Enabled');
    expect(bucketCreate).toHaveBeenCalledWith(expect.objectContaining({ status: 'Active' }));
    expect(grantCreate).toHaveBeenCalledWith(expect.objectContaining({
      grantee: 'owner@example.com',
      level: 'Full',
      status: 'Active',
    }));
  });

  test('CB-07 returns the S3 create error name', async () => {
    s3.on(CreateBucketCommand).rejects(Object.assign(new Error('already exists'), { name: 'BucketAlreadyOwnedByYou' }));
    expect(await invoke(event())).toMatchObject({
      success: false,
      message: expect.stringContaining('BucketAlreadyOwnedByYou'),
    });
  });

  test('CB-08 rolls back when a guardrail step fails', async () => {
    s3.on(PutBucketVersioningCommand).rejects(Object.assign(new Error('denied'), { name: 'AccessDenied' }));
    s3.on(DeleteBucketCommand).resolves({});
    expect(await invoke(event())).toMatchObject({ success: false });
    expect(callsFor(DeleteBucketCommand)).toHaveLength(1);
  });

  test('CB-09 reports record-save failure without deleting the bucket', async () => {
    bucketCreate.mockResolvedValue({ errors: [{ message: 'record unavailable' }] });
    expect(await invoke(event())).toMatchObject({
      success: true,
      message: expect.stringContaining('saving its record failed'),
    });
    expect(callsFor(DeleteBucketCommand)).toHaveLength(0);
  });

  test('CB-10 splits CORS origins from PORTAL_ORIGINS', async () => {
    await invoke(event());
    expect(s3.commandCalls(PutBucketCorsCommand)[0].args[0].input.CORSConfiguration?.CORSRules?.[0].AllowedOrigins)
      .toEqual(['https://one.example.com', 'https://two.example.com']);
  });
});