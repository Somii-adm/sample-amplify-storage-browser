import { createStorageBrowser } from '@aws-amplify/ui-react-storage/browser';
import { generateClient } from 'aws-amplify/data';
import { Hub } from 'aws-amplify/utils';
import type { Schema } from '../amplify/data/resource';
import { shareLinkHandler } from './shareLinkHandler';

// ---- Upload rules (FR-04). Browser-side checks; change values here ----
export const MAX_UPLOAD_GB = 1;
export const BLOCKED_EXTENSIONS = [
  'exe', 'bat', 'cmd', 'com', 'msi', 'ps1', 'sh', 'dll', 'scr', 'vbs', 'jar',
];

export function isAllowedUpload(file: File): boolean {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  return file.size <= MAX_UPLOAD_GB * 1024 * 1024 * 1024 && !BLOCKED_EXTENSIONS.includes(ext);
}

export const { StorageBrowser, useAction, useView } = createStorageBrowser({
  config: {
    region: 'ap-south-1',

    // "Which locations can I see?"
    listLocations: async () => {
      const { data, errors } = await generateClient<Schema>().queries.myLocations();
      if (errors?.length) throw new Error(errors[0].message);
      return {
        items: (data ?? [])
          .filter((l) => l !== null)
          .map((l) => ({
            id: l!.id,
            bucket: l!.bucket,
            prefix: l!.prefix,
            type: l!.type as 'BUCKET' | 'PREFIX',
            permissions: l!.permissions.filter(Boolean) as ('delete' | 'get' | 'list' | 'write')[],
          })),
        nextToken: undefined,
      };
    },

    // "Give me credentials for this location"
    getLocationCredentials: async (location) => {
      const loc = location as { scope: string; permission?: string; permissions?: string[] };
      const perms = (loc.permissions ?? []).map((p) => String(p).toLowerCase());
      const permission =
        loc.permission ?? (perms.some((p) => p.includes('write') || p === 'delete') ? 'READWRITE' : 'READ');

      const { data, errors } = await generateClient<Schema>().queries.locationCredentials({
        scope: loc.scope,
        permission,
      });
      if (errors?.length || !data) {
        throw new Error(errors?.[0]?.message ?? 'Could not get credentials.');
      }
      return {
        credentials: {
          accessKeyId: data.accessKeyId,
          secretAccessKey: data.secretAccessKey,
          sessionToken: data.sessionToken,
          expiration: new Date(data.expiration),
        },
      };
    },

    // On sign-out, forget the previous user
    registerAuthListener: (onAuthStateChange) => {
      Hub.listen('auth', ({ payload }) => {
        if (payload.event === 'signedOut') onAuthStateChange();
      });
    },
  },

  options: {
    validateFile: isAllowedUpload,
  },

  // A "Share link" action in the actions menu when files are selected
  actions: {
    custom: {
      shareLink: {
        actionListItem: {
          icon: 'download',
          label: 'Share link',
          disable: (selected) => !selected?.length,
        },
        handler: shareLinkHandler,
        viewName: 'ShareLinkView',
      },
    },
  },
});
