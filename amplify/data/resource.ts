import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { createBucket } from '../functions/create-bucket/resource';
import { deleteBucket } from '../functions/delete-bucket/resource';
import { CAN_MANAGE_BUCKETS, CAN_VIEW_ADMIN } from '../roles';

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
        status: a.string(),          // ‘Active’ or ‘Deleted’
        deletedBy: a.string(),
        deletedAt: a.datetime(),
        deleteReason: a.string(),

      })
      .authorization((allow) =>  [allow.groups(CAN_VIEW_ADMIN).to(['read'])]),

      // Who may access which bucket/folder, and at what level
    AccessGrant: a
      .model({
        bucketName: a.string().required(),
        prefix: a.string(), // '' = whole bucket, or e.g. 'reports/'
        granteeType: a.string().required(), // 'USER' or 'GROUP'
        grantee: a.string().required(), // user email or group name
        level: a.string().required(), // 'Read' | 'ReadWrite' | 'Full'
        status: a.string(), // 'Active' or 'Revoked'
        grantedBy: a.string(),
        reason: a.string(),
        revokedBy: a.string(),
        revokedAt: a.datetime(),
      })
      .authorization((allow) => [allow.groups(CAN_VIEW_ADMIN).to(['read'])]),

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
      .authorization((allow) => [allow.groups(CAN_MANAGE_BUCKETS)])
      .handler(a.handler.function(createBucket)),

    deleteBucket: a
      .mutation()
      .arguments({
        bucketName: a.string().required(),
        region: a.string().required(),
        recordId: a.string().required(),
        reason: a.string().required(),
      })
      .returns(a.ref('BucketResult'))
      .authorization((allow) => [allow.groups(CAN_MANAGE_BUCKETS)])
      .handler(a.handler.function(deleteBucket)),
  })
  // Let our two functions read and write the data (e.g. BucketRecord rows)
  .authorization((allow) => [allow.resource(createBucket), allow.resource(deleteBucket)]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: { defaultAuthorizationMode: 'userPool' },
});
