import { defineFunction } from '@aws-amplify/backend';

export const deleteBucket = defineFunction({
  name: 'delete-bucket',
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
