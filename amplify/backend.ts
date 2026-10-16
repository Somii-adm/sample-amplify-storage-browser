import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';
import { ArnPrincipal, PolicyStatement, Role } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage, secondaryStorage } from './storage/resource';
import { createBucket } from './functions/create-bucket/resource';
import { deleteBucket } from './functions/delete-bucket/resource';
import { locationAccess } from './functions/location-access/resource';
import { manageAccess } from './functions/manage-access/resource';

const backend = defineBackend({
  auth,
  data,
  storage,
  secondaryStorage,
  createBucket,
  deleteBucket,
  locationAccess,
  manageAccess,
});

// Only admins can create users; no self sign-up
const { cfnUserPool } = backend.auth.resources.cfnResources;
cfnUserPool.adminCreateUserConfig = { allowAdminCreateUserOnly: true };

// create-bucket: may only set up zifotest-* buckets
backend.createBucket.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      's3:CreateBucket',
      's3:DeleteBucket',
      's3:PutBucketPublicAccessBlock',
      's3:PutEncryptionConfiguration',
      's3:PutBucketVersioning',
      's3:PutBucketTagging',
      's3:PutBucketCORS',
    ],
    resources: ['arn:aws:s3:::zifotest-*'],
  })
);

// delete-bucket: may only delete zifotest-* buckets
backend.deleteBucket.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['s3:DeleteBucket'],
    resources: ['arn:aws:s3:::zifotest-*'],
  })
);

// All three functions may look up users (to match emails)
const userPool = backend.auth.resources.userPool;
for (const fn of [backend.createBucket, backend.deleteBucket, backend.locationAccess, backend.manageAccess]) {
  fn.resources.lambda.addToRolePolicy(
    new PolicyStatement({
      actions: ['cognito-idp:AdminGetUser'],
      resources: [userPool.userPoolArn],
    })
  );
  fn.addEnvironment('USER_POOL_ID', userPool.userPoolId);
}

// ---- File access ----
// A role holding the MAXIMUM file access (zifotest-* buckets only).
// location-access borrows it per request and narrows it to one granted folder.
const accessFn = backend.locationAccess.resources.lambda;
const dataAccessRole = new Role(Stack.of(accessFn), 'PortalDataAccessRole', {
  assumedBy: new ArnPrincipal(accessFn.role!.roleArn), // only our Lambda may use it
  description: 'Borrowed by location-access; every session is narrowed to one grant',
});
dataAccessRole.addToPolicy(
  new PolicyStatement({
    actions: [
      's3:GetObject',
      's3:GetObjectVersion',
      's3:PutObject',
      's3:DeleteObject',
      's3:AbortMultipartUpload',
      's3:ListMultipartUploadParts',
    ],
    resources: ['arn:aws:s3:::zifotest-*/*'],
  })
);
dataAccessRole.addToPolicy(
  new PolicyStatement({
    actions: ['s3:ListBucket'],
    resources: ['arn:aws:s3:::zifotest-*'],
  })
);
accessFn.addToRolePolicy(
  new PolicyStatement({
    actions: ['sts:AssumeRole'],
    resources: [dataAccessRole.roleArn],
  })
);
backend.locationAccess.addEnvironment('DATA_ROLE_ARN', dataAccessRole.roleArn);