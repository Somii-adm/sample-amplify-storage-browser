import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
          
      
import { createBucket } from '../functions/create-bucket/resource';

const schema = a.schema({
  BucketResult: a.customType({
    success: a.boolean().required(),
    message: a.string().required(),
  }),

  createBucket: a
    .mutation()
    .arguments({
      bucketName: a.string().required(),
      region: a.string().required(),
      owner: a.string().required(),
      costCenter: a.string().required(),
      businessUnit: a.string().required(),
      classification: a.string().required(),
    })
    .returns(a.ref('BucketResult'))
    .authorization((allow) => [allow.group('admin')]) // admins only
    .handler(a.handler.function(createBucket)),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: 'userPool' },
});