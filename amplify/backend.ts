import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { storage, secondaryStorage } from './storage/resource';


/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */

const backend = defineBackend({
  auth,
  storage, 
  secondaryStorage
});

//no self sign-up
const { cfnUserPool } = backend.auth.resources.cfnResources;
cfnUserPool.adminCreateUserConfig = { allowAdminCreateUserOnly: true};
