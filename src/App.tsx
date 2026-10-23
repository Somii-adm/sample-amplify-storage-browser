import { useEffect, useState } from 'react';
import '@aws-amplify/ui-react-storage/styles.css';
import './App.css';

import config from '../amplify_outputs.json';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';
import { Authenticator, Button, Flex } from '@aws-amplify/ui-react';
import { CAN_VIEW_ADMIN, inAnyGroup } from '../amplify/roles';
import AdminPage from './AdminPage';
import { StorageBrowser, BLOCKED_EXTENSIONS, MAX_UPLOAD_GB } from './storageBrowser';
import { ShareLinkView } from './ShareLinkView';

Amplify.configure(config);

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

      {view === 'files' ? (
        <StorageBrowser
          views={{ ShareLinkView }}
          displayText={{
            // Show our three levels instead of the default "Read/Write"
            LocationsView: {
              getPermissionName: (permissions) =>
                permissions.includes('delete')
                  ? 'Full'
                  : permissions.includes('write')
                  ? 'Read & write'
                  : 'Read only',
            },
            // Explain why a file was rejected
            UploadView: {
              getFilesValidationMessage: (data) => ({
                content: `Not added: ${(data?.invalidFiles ?? [])
                  .map(({ file }) => file.name)
                  .join(', ')}. Files must be ${MAX_UPLOAD_GB} GB or smaller and not program or script files (${BLOCKED_EXTENSIONS.map((e) => '.' + e).join(' ')}).`,
                type: 'error',
              }),
            },
          }}
        />
      ) : (
        <AdminPage groups={groups} />
      )}

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