import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { createBucket } from '../functions/create-bucket/resource';
import { deleteBucket } from '../functions/delete-bucket/resource';

const schema = a
  .schema({
    BucketRecord: a
      .model({
        bucketName: a.string().required(),
        region: a.string(),
        owner: a.string(),
        costCenter: a.string(),
        businessUnit: a.string(),
        classification: a.string(),
        createdBy: a.string(),
      })
      .authorization((allow) => [allow.group('admin')]),

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
      .authorization((allow) => [allow.group('admin')])
      .handler(a.handler.function(createBucket)),

    deleteBucket: a
      .mutation()
      .arguments({
        bucketName: a.string().required(),
        region: a.string().required(),
        recordId: a.string().required(),
      })
      .returns(a.ref('BucketResult'))
      .authorization((allow) => [allow.group('admin')])
      .handler(a.handler.function(deleteBucket)),
  })
  // Let our two functions read and write the data (e.g. BucketRecord rows)
  .authorization((allow) => [allow.resource(createBucket), allow.resource(deleteBucket)]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: 'userPool' },
});
