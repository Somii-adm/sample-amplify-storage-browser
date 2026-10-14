import { useEffect, useState } from 'react';
import {
  createAmplifyAuthAdapter,
  createStorageBrowser,
} from '@aws-amplify/ui-react-storage/browser';
import '@aws-amplify/ui-react-storage/styles.css';
import './App.css';

import config from '../amplify_outputs.json';
import { Amplify } from 'aws-amplify';
import { fetchAuthSession } from 'aws-amplify/auth';
import { Authenticator, Button, Flex } from '@aws-amplify/ui-react';
import AdminPage from './AdminPage';

Amplify.configure(config);

const { StorageBrowser } = createStorageBrowser({
  config: createAmplifyAuthAdapter(),
});

function Portal({ signOut }: { signOut?: () => void }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [view, setView] = useState<'files' | 'admin'>('files');

  // Read the user's groups from their login token
  useEffect(() => {
    fetchAuthSession().then((session) => {
      const groups =
        (session.tokens?.accessToken.payload['cognito:groups'] as string[] | undefined) ?? [];
      setIsAdmin(groups.includes('admin'));
    });
  }, []);

  return (
    <>
      <div className="header">
        <h1>S3 Self-Service Portal</h1>
        <Flex gap="0.5rem">
          <Button
            variation={view === 'files' ? 'primary' : undefined}
            onClick={() => setView('files')}
          >
            Files
          </Button>
          {isAdmin && (
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

      {view === 'files' ? <StorageBrowser /> : <AdminPage />}
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