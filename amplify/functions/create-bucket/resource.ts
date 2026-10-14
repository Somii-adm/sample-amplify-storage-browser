import { defineFunction } from '@aws-amplify/backend';

// Work out this branch's website address at deploy time,
// so new buckets only accept browser calls from our own portal.
const branch = process.env.AWS_BRANCH;
const appId = process.env.AWS_APP_ID;
const portalOrigins = [
  branch && appId ? `https://${branch}.${appId}.amplifyapp.com` : undefined,
  'http://localhost:5173', // for running the site on laptop later
]
  .filter(Boolean)
  .join(',');

export const createBucket = defineFunction({
  name: 'create-bucket',
  timeoutSeconds: 30,
  resourceGroupName: 'data', // avoids a circular-dependency error (see below)
  environment: { PORTAL_ORIGINS: portalOrigins },
});
