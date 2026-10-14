import { defineBackend } from '@aws-amplify/backend';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage, secondaryStorage } from './storage/resource';
import { createBucket } from './functions/create-bucket/resource';

const backend = defineBackend({
  auth,
  data,
  storage,
  secondaryStorage,
  createBucket,
});

// Only admins can create users; no self sign-up
const { cfnUserPool } = backend.auth.resources.cfnResources;
cfnUserPool.adminCreateUserConfig = { allowAdminCreateUserOnly: true };

// The function may only manage buckets that follow our naming rule
backend.createBucket.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      's3:CreateBucket',
      's3:DeleteBucket',
      's3:PutBucketPublicAccessBlock',
      's3:PutEncryptionConfiguration',
      's3:PutBucketVersioning',
      's3:PutBucketTagging',
    ],
    resources: ['arn:aws:s3:::zifotest-*'],
  })
);