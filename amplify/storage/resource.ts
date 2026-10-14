import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
  name: 'myStorageBucket',
  isDefault: true,
   access: (allow) => ({
    'public/*': [
        allow.authenticated.to(['read', 'write', 'delete']),
        allow.groups(['admin','finance']).to(['read', 'write', 'delete'])
    ],
    'admin/*': [
        allow.groups(['admin']).to(['read', 'write', 'delete']),
        allow.groups(['finance']).to(['read']),
        allow.authenticated.to(['read'])
    ],
    'finance/*': [
        allow.groups(['finance']).to(['read', 'write', 'delete']),
        allow.groups(['admin']).to(['read'])
    ],
    'private/{entity_id}/*': [
        allow.entity('identity').to(['read', 'write', 'delete']),
        allow.groups(['admin','finance']).to(['read', 'write', 'delete'])
    ]
   })
});

export const secondaryStorage = defineStorage({
  name: 'mySecondaryStorageBucket',
   access: (allow) => ({
    'backup_public/*': [
        allow.authenticated.to(['read', 'write', 'delete'])
    ],
    'backup_admin/*': [
        allow.groups(['admin']).to(['read', 'write', 'delete']),
        allow.authenticated.to(['read'])
    ],
    'backup_private/{entity_id}/*': [
        allow.entity('identity').to(['read', 'write', 'delete'])
    ]
   })
});



