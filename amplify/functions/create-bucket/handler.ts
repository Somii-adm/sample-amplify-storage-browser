import type { Schema } from '../../data/resource';
          
      
import {
  S3Client,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketEncryptionCommand,
  PutBucketVersioningCommand,
  PutBucketTaggingCommand,
  DeleteBucketCommand,
  BucketLocationConstraint,
} from '@aws-sdk/client-s3';

// ---- Rules: change these to the company's real ones later ----
const ALLOWED_REGIONS = ['ap-south-1'];
const NAME_PATTERN = /^zifotest-[a-z0-9]+-[a-z0-9]+-(dev|test|prod)$/;
const CLASSIFICATIONS = ['Public', 'Internal', 'Confidential', 'Restricted'];

export const handler: Schema['createBucket']['functionHandler'] = async (event) => {
  const { bucketName, region, owner, costCenter, businessUnit, classification } =
    event.arguments;

  // 1. Validate everything before touching AWS
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
  const createdBy = identity?.username ?? 'unknown';

  // 2. Create the bucket
  try {
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucketName,
        // Required outside us-east-1
        CreateBucketConfiguration: {
          LocationConstraint: region as BucketLocationConstraint,
        },
      })
    );
  } catch (err: any) {
    // e.g. BucketAlreadyExists: names are unique across ALL of AWS
    return { success: false, message: `Could not create bucket: ${err.name}` };
  }

  // 3. Switch on guardrails. If any step fails, delete the bucket
  //    so we never leave a half-configured one behind.
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
              BucketKeyEnabled: true, // lowers KMS cost
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
  } catch (err: any) {
    await s3.send(new DeleteBucketCommand({ Bucket: bucketName })).catch(() => {});
    return { success: false, message: `Setup failed (${err.name}); bucket removed.` };
  }

  return { success: true, message: `Bucket ${bucketName} created in ${region}.` };
};