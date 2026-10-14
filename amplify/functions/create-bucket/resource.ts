import { defineFunction } from "@aws-amplify/backend";

export const createBucket = defineFunction({
    name: 'create-bucket',
    timeoutSeconds: 30
});