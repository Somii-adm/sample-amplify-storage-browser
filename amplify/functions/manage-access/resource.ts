import { defineFunction } from '@aws-amplify/backend';

export const manageAccess = defineFunction({
  name: 'manage-access',
  timeoutSeconds: 15,
  resourceGroupName: 'data',
});