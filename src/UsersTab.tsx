import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import {
  Alert, Badge, Button, Card, CheckboxField, Divider, Flex, Heading, SearchField,
  Table, TableBody, TableCell, TableHead, TableRow, Tabs, Text, TextField,
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

// A short, human-readable account status
function statusLabel(u: PortalUser) {
  if (!u.enabled) return { text: 'Disabled', variation: 'error' as const };
  if (u.status === 'FORCE_CHANGE_PASSWORD') return { text: 'Awaiting first sign-in', variation: 'warning' as const };
  return { text: 'Active', variation: 'success' as const };
}

export default function UsersTab() {
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [changes, setChanges] = useState<RoleChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [search, setSearch] = useState('');
  const [managing, setManaging] = useState<string | null>(null);

  // Create-user form (hidden until "Create user" is clicked)
  const [showCreate, setShowCreate] = useState(false);
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
      setChanges([...(c.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    } catch (err) {
      setResult({ success: false, message: `Could not load users: ${String(err)}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visibleUsers = useMemo(
    () => users.filter((u) => u.email.toLowerCase().includes(search.toLowerCase())),
    [users, search]
  );

  const showResult = (r: Result) => {
    setResult(r);
    window.scrollTo({ top: 0, behavior: 'smooth' }); // so the message (and any password) is seen
  };

  const toggleNewRole = (role: string) =>
    setNewRoles(newRoles.includes(role) ? newRoles.filter((r) => r !== role) : [...newRoles, role]);

  async function createUser(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data, errors } = await api().mutations.createPortalUser({ email, roles: newRoles, reason });
      const r: Result = errors?.length
        ? { success: false, message: errors[0].message }
        : data ?? { success: false, message: 'No response from server.' };
      showResult(r);
      if (r.success) {
        setEmail('');
        setNewRoles(['BusinessUser']);
        setReason('');
        setShowCreate(false);
        load();
      }
    } catch (err) {
      showResult({ success: false, message: `Unexpected error: ${String(err)}` });
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
      showResult(
        errors?.length
          ? { success: false, message: errors[0].message }
          : data ?? { success: false, message: 'No response from server.' }
      );
    } catch (err) {
      showResult({ success: false, message: `Unexpected error: ${String(err)}` });
    }
    load();
  }

  return (
    <Flex direction="column" gap="1rem" paddingBlock="0.5rem">
      {result && (
        <Alert
          variation={result.success ? 'success' : 'error'}
          isDismissible
          onDismiss={() => setResult(null)}
        >
          {result.message}
          {result.temporaryPassword && (
            <Text marginTop="0.5rem">
              <strong>Temporary password (shown once):</strong> <code>{result.temporaryPassword}</code>
            </Text>
          )}
        </Alert>
      )}

      <Tabs.Container value={tab} onValueChange={setTab}>
        <Tabs.List>
          <Tabs.Item value="users">Users</Tabs.Item>
          <Tabs.Item value="audit">Audit log</Tabs.Item>
        </Tabs.List>

        {/* ---------- Users ---------- */}
        <Tabs.Panel value="users">
          <Flex direction="column" gap="1rem" paddingBlock="0.75rem">
            <Flex wrap="wrap" gap="0.75rem" alignItems="flex-end" justifyContent="space-between">
              <SearchField
                label="Search"
                labelHidden
                placeholder="Search by email"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onClear={() => setSearch('')}
              />
              <Flex gap="0.5rem">
                <Button onClick={load} isLoading={loading}>Refresh</Button>
                <Button variation="primary" onClick={() => setShowCreate(!showCreate)}>
                  {showCreate ? 'Cancel' : 'Create user'}
                </Button>
              </Flex>
            </Flex>

            {showCreate && (
              <Card variation="outlined">
                <form onSubmit={createUser}>
                  <Flex direction="column" gap="0.75rem" maxWidth="36rem">
                    <Heading level={5}>New user</Heading>
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
                    <Button type="submit" variation="primary" isLoading={busy}>Create user</Button>
                  </Flex>
                </form>
              </Card>
            )}

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
                {visibleUsers.map((u) => {
                  const status = statusLabel(u);
                  const open = managing === u.username;
                  return (
                    <Fragment key={u.username}>
                      <TableRow>
                        <TableCell>{u.email}</TableCell>
                        <TableCell>
                          <Flex wrap="wrap" gap="0.25rem">
                            {u.groups.filter(Boolean).map((g) => (
                              <Badge key={g} size="small">{g}</Badge>
                            ))}
                            {u.groups.length === 0 && <Text fontSize="small">none</Text>}
                          </Flex>
                        </TableCell>
                        <TableCell>
                          <Badge variation={status.variation}>{status.text}</Badge>
                        </TableCell>
                        <TableCell>
                          <Button size="small" onClick={() => setManaging(open ? null : u.username)}>
                            {open ? 'Close' : 'Manage'}
                          </Button>
                        </TableCell>
                      </TableRow>

                      {/* Manage panel: roles + account actions together */}
                      {open && (
                        <TableRow>
                          <TableCell colSpan={4}>
                            <Flex direction="column" gap="0.75rem">
                              <Text fontWeight="bold">Roles</Text>
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

                              <Divider />

                              <Text fontWeight="bold">Account</Text>
                              <Flex gap="0.5rem" wrap="wrap">
                                <Button
                                  size="small"
                                  onClick={() =>
                                    act(
                                      `Reset the password for ${u.email}? They'll get a new temporary password and be signed out.`,
                                      (why) => api().mutations.resetUserPassword({ username: u.username, reason: why })
                                    )
                                  }
                                >
                                  Reset password
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
                            </Flex>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
            {visibleUsers.length === 0 && !loading && <Text>No users match.</Text>}
          </Flex>
        </Tabs.Panel>

        {/* ---------- Audit log ---------- */}
        <Tabs.Panel value="audit">
          <Flex direction="column" gap="0.75rem" paddingBlock="0.75rem">
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
        </Tabs.Panel>
      </Tabs.Container>
    </Flex>
  );
}
