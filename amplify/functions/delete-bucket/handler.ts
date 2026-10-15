import type { Schema } from '../../data/resource';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/delete-bucket';
import { S3Client, DeleteBucketCommand } from '@aws-sdk/client-s3';
import { emailFor } from '../shared/user-email';
import { CAN_MANAGE_BUCKETS, inAnyGroup } from '../../roles';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

export const handler: Schema['deleteBucket']['functionHandler'] = async (event) => {

  // Defence in depth: check the role here too, not only in the API
  const callerGroups = (event.identity as { groups?: string[] | null } | null)?.groups;
  if (!inAnyGroup(callerGroups, CAN_MANAGE_BUCKETS)) {
    return { success: false, message: 'You are not allowed to manage buckets.' };
  }
  const { bucketName, region, recordId, reason } = event.arguments;

  if (!bucketName.startsWith('zifotest-')) {
    return { success: false, message: 'Only portal-managed buckets can be deleted.' };
  }
  // Check the reason on the server too: never trust the browser alone
  if (reason.trim().length < 5) {
    return { success: false, message: 'Please give a reason (at least 5 characters).' };
  }

  const identity = event.identity as { username?: string } | null;
  const deletedBy = await emailFor(identity?.username);

  const s3 = new S3Client({ region });
  try {
    await s3.send(new DeleteBucketCommand({ Bucket: bucketName }));
  } catch (err: any) {
    if (err.name === 'BucketNotEmpty') {
      return {
        success: false,
        message: 'Bucket is not empty (this includes old file versions). Empty it first.',
      };
    }
    if (err.name !== 'NoSuchBucket') {
      return { success: false, message: `Could not delete bucket: ${err.name}` };
    }
  }

  // Keep the record, marked as deleted, so the history survives
  const { errors } = await client.models.BucketRecord.update({
    id: recordId,
    status: 'Deleted',
    deletedBy,
    deletedAt: new Date().toISOString(),
    deleteReason: reason.trim(),
  });
  if (errors?.length) {
    return {
      success: true,
      message: `Bucket ${bucketName} deleted, but updating its record failed: ${errors[0].message}`,
    };
  }
  
  // Revoke every active grant on this bucket (kept, not erased, for audit)
  const { data: grants } = await client.models.AccessGrant.list({
    filter: { bucketName: { eq: bucketName }, status: { eq: 'Active' } },
  });
  for (const g of grants ?? []) {
    await client.models.AccessGrant.update({
      id: g.id,
      status: 'Revoked',
      revokedBy: deletedBy,
      revokedAt: new Date().toISOString(),
    });
  }

  return { success: true, message: `Bucket ${bucketName} deleted.` };
};
