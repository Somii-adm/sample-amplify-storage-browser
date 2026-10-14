import type { Schema } from '../../data/resource';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { env } from '$amplify/env/delete-bucket';
import { S3Client, DeleteBucketCommand } from '@aws-sdk/client-s3';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>();

export const handler: Schema['deleteBucket']['functionHandler'] = async (event) => {
  const { bucketName, region, recordId } = event.arguments;

  if (!bucketName.startsWith('zifotest-')) {
    return { success: false, message: 'Only portal-managed buckets can be deleted.' };
  }

  const s3 = new S3Client({ region });
  try {
    // AWS itself refuses to delete a bucket that still has files in it
    await s3.send(new DeleteBucketCommand({ Bucket: bucketName }));
  } catch (err: any) {
    if (err.name === 'BucketNotEmpty') {
      return {
        success: false,
        message: 'Bucket is not empty (this includes old file versions). Empty it first.',
      };
    }
    // NoSuchBucket = already gone, so carry on and clean up the record
    if (err.name !== 'NoSuchBucket') {
      return { success: false, message: `Could not delete bucket: ${err.name}` };
    }
  }

  await client.models.BucketRecord.delete({ id: recordId });
  return { success: true, message: `Bucket ${bucketName} deleted.` };
};
