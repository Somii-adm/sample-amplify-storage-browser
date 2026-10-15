import { defineBackend } from '@aws-amplify/backend';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage, secondaryStorage } from './storage/resource';
import { createBucket } from './functions/create-bucket/resource';
import { deleteBucket } from './functions/delete-bucket/resource';

const backend = defineBackend({
  auth,
  data,
  storage,
  secondaryStorage,
  createBucket,
  deleteBucket,
});

// Only admins can create users; no self sign-up
const { cfnUserPool } = backend.auth.resources.cfnResources;
cfnUserPool.adminCreateUserConfig = { allowAdminCreateUserOnly: true };

// create-bucket: may only set up zifotest-* buckets
backend.createBucket.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      's3:CreateBucket',
      's3:DeleteBucket', // only used to undo a failed setup
      's3:PutBucketPublicAccessBlock',
      's3:PutEncryptionConfiguration',
      's3:PutBucketVersioning',
      's3:PutBucketTagging',
      's3:PutBucketCORS',
    ],
    resources: ['arn:aws:s3:::zifotest-*'],
  })
);

// delete-bucket: may only delete zifotest-* buckets, nothing else
backend.deleteBucket.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['s3:DeleteBucket'],
    resources: ['arn:aws:s3:::zifotest-*'],
  })
);

//loopup users
const userPool = backend.auth.resources.userPool;
for (const fn of [backend.createBucket, backend.deleteBucket]) {
  fn.resources.lambda.addToRolePolicy(
    new PolicyStatement({
      actions: ['cognito-idp:AdminGetUser'],
      resources: [userPool.userPoolArn],
    })
  );
  fn.addEnvironment('USER_POOL_ID', userPool.userPoolId);
}
