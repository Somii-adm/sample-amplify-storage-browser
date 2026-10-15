import type { Schema } from '../../data/resource';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/location-access';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { emailFor } from '../shared/user-email';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();
const sts = new STSClient();

// How strong each level is, what the Storage Browser shows for it,
// and which S3 actions the credentials will allow
const LEVEL_RANK: Record<string, number> = { Read: 1, ReadWrite: 2, Full: 3 };
const LEVEL_PERMISSIONS: Record<string, string[]> = {
  Read: ['get', 'list'],
  ReadWrite: ['get', 'list', 'write'],
  Full: ['get', 'list', 'write', 'delete'],
};
const READ_ACTIONS = ['s3:GetObject', 's3:GetObjectVersion'];
const WRITE_ACTIONS = [...READ_ACTIONS, 's3:PutObject', 's3:AbortMultipartUpload', 's3:ListMultipartUploadParts'];
const LEVEL_ACTIONS: Record<string, string[]> = {
  Read: READ_ACTIONS,
  ReadWrite: WRITE_ACTIONS,
  Full: [...WRITE_ACTIONS, 's3:DeleteObject'],
};

type Grant = { bucketName: string; prefix: string; level: string };

// Every active grant that applies to this caller: by their email OR any of their groups
async function grantsFor(identity: any): Promise<Grant[]> {
  const email = (await emailFor(identity?.username)).toLowerCase();
  const groups: string[] = identity?.groups ?? [];
  const { data } = await client.models.AccessGrant.list({
    filter: { status: { eq: 'Active' } },
    limit: 1000,
  });
  return (data ?? [])
    .filter(
      (g) =>
        (g.granteeType === 'USER' && g.grantee === email) ||
        (g.granteeType === 'GROUP' && groups.includes(g.grantee))
    )
    .map((g) => ({ bucketName: g.bucketName, prefix: g.prefix ?? '', level: g.level }));
}

// "Which locations can I see?" If several grants cover the same place, keep the strongest
async function myLocations(identity: any) {
  const best = new Map<string, Grant>();
  for (const g of await grantsFor(identity)) {
    const key = `${g.bucketName}/${g.prefix}`;
    const current = best.get(key);
    if (!current || LEVEL_RANK[g.level] > LEVEL_RANK[current.level]) best.set(key, g);
  }
  return [...best.entries()].map(([key, g]) => ({
    id: key,
    bucket: g.bucketName,
    prefix: g.prefix,
    type: g.prefix ? 'PREFIX' : 'BUCKET',
    permissions: LEVEL_PERMISSIONS[g.level] ?? [],
  }));
}

// "Give me credentials for this location"
async function locationCredentials(identity: any, scope: string, permission: string) {
  // scope looks like s3://bucket/* or s3://bucket/folder/* (or one file's key)
  const match = /^s3:\/\/([^/]+)\/(.*)$/.exec(scope);
  if (!match) throw new Error('Invalid location.');
  const bucket = match[1];
  const path = match[2].replace(/\*$/, ''); // '' = whole bucket, 'folder/' = a folder

  // The strongest grant that covers this path
  const covering = (await grantsFor(identity))
    .filter((g) => g.bucketName === bucket && path.startsWith(g.prefix))
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level])[0];

  if (!covering) throw new Error('Access denied: you have no access to this location.');
  if (permission !== 'READ' && LEVEL_RANK[covering.level] < LEVEL_RANK.ReadWrite) {
    throw new Error('Access denied: you have read-only access here.');
  }

  // A one-off policy: only this path, only the actions this level allows
  const sessionPolicy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: LEVEL_ACTIONS[covering.level],
        Resource: `arn:aws:s3:::${bucket}/${path}*`,
      },
      {
        Effect: 'Allow',
        Action: ['s3:ListBucket'],
        Resource: `arn:aws:s3:::${bucket}`,
        // For a folder grant, only allow listing inside that folder
        ...(path ? { Condition: { StringLike: { 's3:prefix': [`${path}*`] } } } : {}),
      },
    ],
  };

  const { Credentials } = await sts.send(
    new AssumeRoleCommand({
      RoleArn: process.env.DATA_ROLE_ARN,
      RoleSessionName: `portal-${identity?.username ?? 'user'}`.slice(0, 64),
      DurationSeconds: 900, // 15 minutes; the browser asks again when they expire
      Policy: JSON.stringify(sessionPolicy),
    })
  );
  if (!Credentials) throw new Error('Could not issue credentials.');

  return {
    accessKeyId: Credentials.AccessKeyId!,
    secretAccessKey: Credentials.SecretAccessKey!,
    sessionToken: Credentials.SessionToken!,
    expiration: Credentials.Expiration!.toISOString(),
  };
}

// One function serves both API operations; AppSync tells us which one was called
export const handler = async (event: any) => {
  // Amplify sends the operation name as event.fieldName (AppSync's own format uses event.info.fieldName)
  const fieldName = event.fieldName ?? event.info?.fieldName;
  console.log('location-access called for:', fieldName); // shows up in CloudWatch logs
  switch (fieldName) {
    case 'myLocations':
      return myLocations(event.identity);
    case 'locationCredentials':
      return locationCredentials(event.identity, event.arguments.scope, event.arguments.permission);
    default:
      throw new Error(`Unknown operation: ${fieldName}`);
  }
};