import type { Schema } from '../../data/resource';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/manage-access';
import { emailFor } from '../shared/user-email';
import { ALL_ROLES, CAN_MANAGE_ACCESS, DATA_GROUPS, inAnyGroup } from '../../roles';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

const LEVELS = ['Read', 'ReadWrite', 'Full'];
const KNOWN_GROUPS = [...ALL_ROLES, ...DATA_GROUPS];
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Result = { success: boolean; message: string };
const fail = (message: string): Result => ({ success: false, message });

// Clean a folder path: '' = whole bucket, otherwise always 'a/b/' (ending in '/')
// Returns null if the path is unsafe
function cleanPrefix(raw: string | null | undefined): string | null {
  const p = (raw ?? '').trim().replace(/^\/+/, ''); // drop leading slashes
  if (!p) return '';
  if (p.includes('..') || p.includes('*')) return null;
  return p.endsWith('/') ? p : `${p}/`;
}

async function grantAccess(args: any, callerEmail: string): Promise<Result> {
  const reason = (args.reason ?? '').trim();
  if (reason.length < 5) return fail('Please give a reason (at least 5 characters).');
  if (!LEVELS.includes(args.level)) return fail(`Level must be one of: ${LEVELS.join(', ')}.`);

  const prefix = cleanPrefix(args.prefix);
  if (prefix === null) return fail('Folder path cannot contain ".." or "*".');

  // Who is being granted access?
  let grantee = String(args.grantee ?? '').trim();
  if (args.granteeType === 'USER') {
    grantee = grantee.toLowerCase();
    if (!EMAIL_PATTERN.test(grantee)) return fail('Enter a valid email address.');
    if (grantee === callerEmail.toLowerCase()) {
      return fail('You cannot grant access to yourself. Ask another admin.');
    }
  } else if (args.granteeType === 'GROUP') {
    if (!KNOWN_GROUPS.includes(grantee)) {
      return fail(`Unknown group. Choose one of: ${KNOWN_GROUPS.join(', ')}.`);
    }
  } else {
    return fail('Grant to must be a user or a group.');
  }

  // The bucket must be an active portal bucket
  const { data: records } = await client.models.BucketRecord.list({
    filter: { bucketName: { eq: args.bucketName } },
    limit: 1000,
  });
  if (!(records ?? []).some((r) => r.status !== 'Deleted')) {
    return fail('That bucket is not an active portal bucket.');
  }

// Read every page so the duplicate check can't miss anything
  const existing: Schema['AccessGrant']['type'][] = [];
  let nextToken: string | null | undefined;
  do {
    const page = await client.models.AccessGrant.list({
      filter: { bucketName: { eq: args.bucketName }, status: { eq: 'Active' } },
      nextToken,
    });
    existing.push(...(page.data ?? []));
    nextToken = page.nextToken;
  } while (nextToken);

  const duplicate = existing.find(

    (g) =>
      (g.prefix ?? '') === prefix &&
      g.granteeType === args.granteeType &&
      g.grantee === grantee
  );
  if (duplicate) {
    return fail(`${grantee} already has ${duplicate.level} access here. Revoke it first to change the level.`);
  }

  const { errors } = await client.models.AccessGrant.create({
    bucketName: args.bucketName,
    prefix,
    granteeType: args.granteeType,
    grantee,
    level: args.level,
    status: 'Active',
    grantedBy: callerEmail,
    reason,
  });
  if (errors?.length) return fail(`Could not save the grant: ${errors[0].message}`);

  return {
    success: true,
    message: `Granted ${args.level} on ${args.bucketName}/${prefix} to ${grantee}.`,
  };
}

async function revokeAccess(args: any, callerEmail: string): Promise<Result> {
  const reason = (args.reason ?? '').trim();
  if (reason.length < 5) return fail('Please give a reason (at least 5 characters).');

  const { data: grant } = await client.models.AccessGrant.get({ id: args.grantId });
  if (!grant) return fail('Grant not found.');
  if (grant.status === 'Revoked') return fail('That grant is already revoked.');

  const { errors } = await client.models.AccessGrant.update({
    id: grant.id,
    status: 'Revoked',
    revokedBy: callerEmail,
    revokedAt: new Date().toISOString(),
    revokeReason: reason,
  });
  if (errors?.length) return fail(`Could not revoke: ${errors[0].message}`);

  return {
    success: true,
    message: `Revoked ${grant.grantee}'s access to ${grant.bucketName}/${grant.prefix ?? ''}.`,
  };
}

export const handler = async (event: any): Promise<Result> => {
  const fieldName = event.fieldName ?? event.info?.fieldName;

  // Defence in depth: check the role here too, not only in the API
  if (!inAnyGroup(event.identity?.groups, CAN_MANAGE_ACCESS)) {
    return fail('You are not allowed to manage access.');
  }
  const callerEmail = await emailFor(event.identity?.username);

  switch (fieldName) {
    case 'grantAccess':
      return grantAccess(event.arguments, callerEmail);
    case 'revokeAccess':
      return revokeAccess(event.arguments, callerEmail);
    default:
      return fail(`Unknown operation: ${fieldName}`);
  }
};