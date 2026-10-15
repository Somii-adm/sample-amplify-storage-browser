import { defineFunction } from '@aws-amplify/backend';

export const locationAccess = defineFunction({
  name: 'location-access',
  timeoutSeconds: 15,
  resourceGroupName: 'data',
});