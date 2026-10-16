import { defineFunction } from '@aws-amplify/backend';

export const manageUsers = defineFunction({
  name: 'manage-users',
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});