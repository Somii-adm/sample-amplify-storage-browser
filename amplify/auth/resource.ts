import { defineAuth } from '@aws-amplify/backend';
import { createBucket } from '../functions/create-bucket/resource';

/**
 * Define and configure your auth resource
 * @see https://docs.amplify.aws/gen2/build-a-backend/auth
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ['admin', 'finance'], //added finance group 
  access: (allow) => [allow.resource(createBucket).to(['getUser'])]
});
