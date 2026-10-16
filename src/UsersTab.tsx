import { useCallback, useEffect, useState, type FormEvent } from 'react';
          
      
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import {
  Alert, Badge, Button, CheckboxField, Flex, Heading,
  Table, TableBody, TableCell, TableHead, TableRow, Text, TextField,
} from '@aws-amplify/ui-react';
import { ALL_ROLES, DATA_GROUPS } from '../amplify/roles';

type PortalUser = {
  username: string;
  email: string;
  enabled: boolean;
  status: string;
  groups: (string | null)[];
  createdAt: string;
};
type RoleChange = Schema['RoleChange']['type'];
type Result = { success: boolean; message: string; temporaryPassword?: string | null };

const ROLE_OPTIONS = [...ALL_ROLES, ...DATA_GROUPS];
const api = () => generateClient<Schema>();

export default function UsersTab() {
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [changes, setChanges] = useState<RoleChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // New-user form
  const [email, setEmail] = useState('');
  const [newRoles, setNewRoles] = useState<string[]>(['BusinessUser']);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, c] = await Promise.all([
        api().queries.listPortalUsers(),
        api().models.RoleChange.list({ limit: 1000 }),
      ]);
      if (u.errors?.length) setResult({ success: false, message: u.errors[0].message });
      setUsers((u.data ?? []).filter(Boolean) as PortalUser[]);
      // Newest 20 changes first
      setChanges(
        [...(c.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)
      );
    } catch (err) {
      setResult({ success: false, message: `Could not load users: ${String(err)}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleNewRole = (role: string) =>
    setNewRoles(newRoles.includes(role) ? newRoles.filter((r) => r !== role) : [...newRoles, role]);

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const { data, errors } = await api().mutations.createPortalUser({ email, roles: newRoles, reason });
      const r: Result = errors?.length
        ? { success: false, message: errors[0].message }
        : data ?? { success: false, message: 'No response from server.' };
      setResult(r);
      if (r.success) {
        setEmail('');
        setNewRoles(['BusinessUser']);
        setReason('');
        load();
      }
    } catch (err) {
      setResult({ success: false, message: `Unexpected error: ${String(err)}` });
    } finally {
      setBusy(false);
    }
  }

  // Ask for a reason, run the change, show the result, reload
  async function act(question: string, run: (why: string) => Promise<any>) {
    const why = window.prompt(`${question}\nReason (recorded for audit):`);
    if (why === null) return;
    try {
      const { data, errors } = await run(why);
      setResult(
        errors?.length
          ? { success: false, message: errors[0].message }
          : data ?? { success: false, message: 'No response from server.' }
      );
    } catch (err) {
      setResult({ success: false, message: `Unexpected error: ${String(err)}` });
    }
    load();
  }

  return (
    <Flex direction="column" gap="1.5rem" paddingBlock="0.5rem">
      {result && (
        <Alert
          variation={result.success ? 'success' : 'error'}
          isDismissible
          onDismiss={() => setResult(null)}
        >
          {result.message}
          {result.temporaryPassword && (
            <Text marginTop="0.5rem">
              <strong>Temporary password (shown once):</strong>{' '}
              <code>{result.temporaryPassword}</code>
            </Text>
          )}
        </Alert>
      )}

      {/* Create user */}
      <form onSubmit={createUser}>
        <Flex direction="column" gap="0.75rem" maxWidth="36rem">
          <Heading level={4}>Create user</Heading>
          <TextField label="Email" value={email} onChange={(e) => setEmail(e.target.value)} isRequired />
          <Text fontWeight="bold">Roles</Text>
          <Flex wrap="wrap" gap="1rem">
            {ROLE_OPTIONS.map((r) => (
              <CheckboxField
                key={r}
                name={`new-${r}`}
                label={r}
                checked={newRoles.includes(r)}
                onChange={() => toggleNewRole(r)}
              />
            ))}
          </Flex>
          <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} isRequired />
          <Button type="submit" variation="primary" isLoading={busy}>
            Create user
          </Button>
        </Flex>
      </form>

      {/* Users */}
      <Flex direction="column" gap="0.75rem">
        <Flex justifyContent="space-between" alignItems="center">
          <Heading level={4}>Users</Heading>
          <Button onClick={load} isLoading={loading}>Refresh</Button>
        </Flex>
        <Text fontSize="small">Role changes take effect at the user's next sign-in.</Text>

        <Table highlightOnHover>
          <TableHead>
            <TableRow>
              <TableCell as="th">Email</TableCell>
              <TableCell as="th">Roles</TableCell>
              <TableCell as="th">Status</TableCell>
              <TableCell as="th"></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((u) => (
              <>
                <TableRow key={u.username}>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <Flex wrap="wrap" gap="0.25rem">
                      {u.groups.filter(Boolean).map((g) => (
                        <Badge key={g}>{g}</Badge>
                      ))}
                      {u.groups.length === 0 && <Text fontSize="small">none</Text>}
                    </Flex>
                  </TableCell>
                  <TableCell>
                    <Badge variation={u.enabled ? 'success' : 'error'}>
                      {u.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                    {u.status === 'FORCE_CHANGE_PASSWORD' && (
                      <Text fontSize="small">Must change password</Text>
                    )}
                  </TableCell>
                  <TableCell>
                    <Flex gap="0.5rem">
                      <Button
                        size="small"
                        onClick={() => setExpanded(expanded === u.username ? null : u.username)}
                      >
                        {expanded === u.username ? 'Close' : 'Roles'}
                      </Button>
                      <Button
                        size="small"
                        variation={u.enabled ? 'destructive' : undefined}
                        onClick={() =>
                          act(`${u.enabled ? 'Disable' : 'Enable'} ${u.email}?`, (why) =>
                            api().mutations.setUserEnabled({
                              username: u.username,
                              enabled: !u.enabled,
                              reason: why,
                            })
                          )
                        }
                      >
                        {u.enabled ? 'Disable' : 'Enable'}
                      </Button>
                    </Flex>
                  </TableCell>
                </TableRow>

                {/* Role checkboxes: ticking or unticking asks for a reason */}
                {expanded === u.username && (
                  <TableRow key={`${u.username}-roles`}>
                    <TableCell colSpan={4}>
                      <Flex wrap="wrap" gap="1rem">
                        {ROLE_OPTIONS.map((r) => {
                          const has = u.groups.includes(r);
                          return (
                            <CheckboxField
                              key={r}
                              name={`${u.username}-${r}`}
                              label={r}
                              checked={has}
                              onChange={() =>
                                act(`${has ? 'Remove' : 'Add'} ${r} ${has ? 'from' : 'to'} ${u.email}?`, (why) =>
                                  api().mutations.setUserRole({
                                    username: u.username,
                                    role: r,
                                    add: !has,
                                    reason: why,
                                  })
                                )
                              }
                            />
                          );
                        })}
                      </Flex>
                    </TableCell>
                  </TableRow>
                )}
              </>
            ))}
          </TableBody>
        </Table>
      </Flex>

      {/* Audit trail */}
      <Flex direction="column" gap="0.75rem">
        <Heading level={4}>Recent changes</Heading>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell as="th">When</TableCell>
              <TableCell as="th">By</TableCell>
              <TableCell as="th">Action</TableCell>
              <TableCell as="th">User</TableCell>
              <TableCell as="th">Role</TableCell>
              <TableCell as="th">Reason</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {changes.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{new Date(c.createdAt).toLocaleString()}</TableCell>
                <TableCell>{c.performedBy}</TableCell>
                <TableCell>{c.action}</TableCell>
                <TableCell>{c.targetEmail}</TableCell>
                <TableCell>{c.role}</TableCell>
                <TableCell>{c.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {changes.length === 0 && <Text>No changes recorded yet.</Text>}
      </Flex>
    </Flex>
  );
}