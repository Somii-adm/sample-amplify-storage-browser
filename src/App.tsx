import { useEffect, useState } from 'react';
import { createStorageBrowser } from '@aws-amplify/ui-react-storage/browser';
import '@aws-amplify/ui-react-storage/styles.css';
import './App.css';

import config from '../amplify_outputs.json';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';
import { generateClient } from 'aws-amplify/data';
import { Hub } from 'aws-amplify/utils';
import { Authenticator, Button, Flex } from '@aws-amplify/ui-react';
import type { Schema } from '../amplify/data/resource';
import { CAN_VIEW_ADMIN, inAnyGroup } from '../amplify/roles';
import AdminPage from './AdminPage';

Amplify.configure(config);

// The Storage Browser now gets its locations and credentials from OUR API,
// which reads the AccessGrant table
const { StorageBrowser } = createStorageBrowser({
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

    getLocationCredentials: async (location) => {
      // The field name differs between library versions, so read it flexibly:
      // some send `permission` ('READ' | 'WRITE' | 'READWRITE'), others a `permissions` list
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

    // On sign-out, tell the Storage Browser to forget the previous user
    // (fixes the stale view when switching users)
    registerAuthListener: (onAuthStateChange) => {
      Hub.listen('auth', ({ payload }) => {
        if (payload.event === 'signedOut') onAuthStateChange();
      });
    },
  },
});

function Portal({ signOut }: { signOut?: () => void }) {
  const [groups, setGroups] = useState<string[]>([]);
  const [view, setView] = useState<'files' | 'admin'>('files');

  // Read the user's groups (roles) from their login token
  useEffect(() => {
    fetchAuthSession().then((session) => {
      setGroups(
        (session.tokens?.accessToken.payload['cognito:groups'] as string[] | undefined) ?? []
      );
    });
  }, []);

  const canViewAdmin = inAnyGroup(groups, CAN_VIEW_ADMIN);

  return (
    <>
      <div className="header">
        <div>
          <h1>S3 Self-Service Portal</h1>
          <small>Role: {groups.length ? groups.join(', ') : 'none'}</small>
        </div>
        <Flex gap="0.5rem">
          <Button
            variation={view === 'files' ? 'primary' : undefined}
            onClick={() => setView('files')}
          >
            Files
          </Button>
          {canViewAdmin && (
            <Button
              variation={view === 'admin' ? 'primary' : undefined}
              onClick={() => setView('admin')}
            >
              Admin
            </Button>
          )}
          <Button onClick={signOut}>Sign out</Button>
        </Flex>
      </div>

      {view === 'files' ? <StorageBrowser /> : <AdminPage groups={groups} />}
    </>
  );
}

export default function App() {
  return (
    <Authenticator>
      {({ signOut }) => <Portal signOut={signOut} />}
    </Authenticator>
  );
}