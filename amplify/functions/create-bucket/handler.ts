import type { Schema } from '../../data/resource';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/create-bucket';
import { emailFor } from '../shared/user-email';
import { CAN_MANAGE_BUCKETS, inAnyGroup } from '../../roles';
import {
  S3Client,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketEncryptionCommand,
  PutBucketVersioningCommand,
  PutBucketTaggingCommand,
  PutBucketCorsCommand,
  DeleteBucketCommand,
  BucketLocationConstraint,
} from '@aws-sdk/client-s3';

// Connect this function to the portal's data API, so it can save BucketRecord rows
const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

// ---- Rules: change these to the company's real ones later ----
const ALLOWED_REGIONS = ['ap-south-1'];
const NAME_PATTERN = /^zifotest-[a-z0-9]+-[a-z0-9]+-(dev|test|prod)$/;
const CLASSIFICATIONS = ['Public', 'Internal', 'Confidential', 'Restricted'];




export const handler: Schema['createBucket']['functionHandler'] = async (event) => {
  
  // Defence in depth: check the role here too, not only in the API
  const callerGroups = (event.identity as { groups?: string[] | null } | null)?.groups;
  if (!inAnyGroup(callerGroups, CAN_MANAGE_BUCKETS)) {
    return { success: false, message: 'You are not allowed to manage buckets.' };
  }

  const { bucketName, region, owner, costCenter, businessUnit, classification } =
    event.arguments;

  // 1. Validate
  const errors: string[] = [];
  if (!NAME_PATTERN.test(bucketName) || bucketName.length > 63) {
    errors.push('Name must look like zifotest-<team>-<purpose>-<dev|test|prod>, lowercase.');
  }
  if (!ALLOWED_REGIONS.includes(region)) {
    errors.push(`Region must be one of: ${ALLOWED_REGIONS.join(', ')}.`);
  }
  if (!CLASSIFICATIONS.includes(classification)) {
    errors.push(`Classification must be one of: ${CLASSIFICATIONS.join(', ')}.`);
  }
  if (!owner.includes('@')) errors.push('Owner must be an email address.');
  if (!costCenter.trim() || !businessUnit.trim()) {
    errors.push('Cost center and business unit are required.');
  }
  if (errors.length > 0) return { success: false, message: errors.join(' ') };

  const s3 = new S3Client({ region });
  const identity = event.identity as { username?: string } | null;
  const createdBy = await emailFor(identity?.username);

  // 2. Create the bucket
  try {
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucketName,
        CreateBucketConfiguration: {
          LocationConstraint: region as BucketLocationConstraint,
        },
      })
    );
  } catch (err: any) {
    return { success: false, message: `Could not create bucket: ${err.name}` };
  }

  // 3. Guardrails. If any step fails, delete the bucket again.
  try {
    await s3.send(
      new PutPublicAccessBlockCommand({
        Bucket: bucketName,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
      })
    );
    await s3.send(
      new PutBucketEncryptionCommand({
        Bucket: bucketName,
        ServerSideEncryptionConfiguration: {
          Rules: [
            {
              ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'aws:kms' },
              BucketKeyEnabled: true,
            },
          ],
        },
      })
    );
    await s3.send(
      new PutBucketVersioningCommand({
        Bucket: bucketName,
        VersioningConfiguration: { Status: 'Enabled' },
      })
    );
    await s3.send(
      new PutBucketTaggingCommand({
        Bucket: bucketName,
        Tagging: {
          TagSet: [
            { Key: 'Owner', Value: owner },
            { Key: 'CostCenter', Value: costCenter },
            { Key: 'BusinessUnit', Value: businessUnit },
            { Key: 'DataClassification', Value: classification },
            { Key: 'CreatedBy', Value: createdBy },
            { Key: 'ManagedBy', Value: 's3-portal' },
          ],
        },
      })
    );
    // NEW: only our portal's web address may call this bucket from a browser
    await s3.send(
      new PutBucketCorsCommand({
        Bucket: bucketName,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: env.PORTAL_ORIGINS.split(','),
              AllowedMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE'],
              AllowedHeaders: ['*'],
              ExposeHeaders: [
                'last-modified', 'content-type', 'content-length', 'etag',
                'x-amz-version-id', 'x-amz-request-id', 'x-amz-id-2',
                'x-amz-cf-id', 'x-amz-storage-class', 'date',
                'access-control-expose-headers',
              ],
              MaxAgeSeconds: 3000,
            },
          ],
        },
      })
    );
  } catch (err: any) {
    await s3.send(new DeleteBucketCommand({ Bucket: bucketName })).catch(() => {});
    return { success: false, message: `Setup failed (${err.name}); bucket removed.` };
  }

  // 4. NEW: record it in the portal's table
  const { errors: recordErrors } = await client.models.BucketRecord.create({
    bucketName,
    region,
    owner,
    costCenter,
    businessUnit,
    classification,
    createdBy,
    status: 'Active',
  });
  if (recordErrors?.length) {
    // The bucket is fine; only the bookkeeping failed, so don't delete it
    return {
      success: true,
      message: `Bucket ${bucketName} created, but saving its record failed: ${recordErrors[0].message}`,
    };
  }

  return { success: true, message: `Bucket ${bucketName} created in ${region}.` };
};

