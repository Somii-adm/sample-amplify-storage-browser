import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import {
  Alert, Badge, Button, CheckboxField, Flex, Heading, SelectField,
  Table, TableBody, TableCell, TableHead, TableRow, Text, TextField,
} from '@aws-amplify/ui-react';
import { ALL_ROLES, CAN_MANAGE_ACCESS, DATA_GROUPS, inAnyGroup } from '../amplify/roles';

type AccessGrant = Schema['AccessGrant']['type'];
type Result = { success: boolean; message: string };

const emptyForm = {
  bucketName: '',
  prefix: '',
  granteeType: 'USER',
  grantee: '',
  level: 'Read',
  reason: '',
};

export default function AccessTab({ groups }: { groups: string[] }) {
  const canManage = inAnyGroup(groups, CAN_MANAGE_ACCESS);

  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [bucketNames, setBucketNames] = useState<string[]>([]);
  const [showRevoked, setShowRevoked] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // Load grants and active buckets (for the dropdown) at the same time
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const client = generateClient<Schema>();
      const [g, b] = await Promise.all([
        client.models.AccessGrant.list({ limit: 1000 }),
        client.models.BucketRecord.list({ limit: 1000 }),
      ]);
      if (g.errors?.length) setResult({ success: false, message: g.errors[0].message });
      setGrants([...(g.data ?? [])].sort((x, y) => x.bucketName.localeCompare(y.bucketName)));
      setBucketNames(
        (b.data ?? []).filter((r) => r.status !== 'Deleted').map((r) => r.bucketName).sort()
      );
    } catch (err) {
      setResult({ success: false, message: `Could not load: ${String(err)}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () => grants.filter((g) => showRevoked || g.status !== 'Revoked'),
    [grants, showRevoked]
  );

  const update =
    (field: keyof typeof emptyForm) => (e: { target: { value: string } }) =>
      setForm({ ...form, [field]: e.target.value });

  async function grant(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const { data, errors } = await generateClient<Schema>().mutations.grantAccess(form);
      const r: Result = errors?.length
        ? { success: false, message: errors[0].message }
        : data ?? { success: false, message: 'No response from server.' };
      setResult(r);
      if (r.success) {
        setForm(emptyForm);
        load();
      }
    } catch (err) {
      setResult({ success: false, message: `Unexpected error: ${String(err)}` });
    } finally {
      setBusy(false);
    }
  }

  async function revoke(g: AccessGrant) {
    const reason = window.prompt(
      `Revoke ${g.grantee}'s ${g.level} access to ${g.bucketName}/${g.prefix ?? ''}?\n` +
        'Reason (recorded for audit):'
    );
    if (reason === null) return; // cancelled
    try {
      const { data, errors } = await generateClient<Schema>().mutations.revokeAccess({
        grantId: g.id,
        reason,
      });
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
        </Alert>
      )}

      {/* Grant form: only for SecurityAdmin / SuperAdmin */}
      {canManage && (
        <form onSubmit={grant}>
          <Flex direction="column" gap="0.75rem" maxWidth="36rem">
            <Heading level={4}>Grant access</Heading>

            <SelectField label="Bucket" value={form.bucketName} onChange={update('bucketName')} isRequired>
              <option value="">Choose a bucket…</option>
              {bucketNames.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </SelectField>

            <TextField
              label="Folder (optional)"
              descriptiveText="Leave empty for the whole bucket, e.g. reports/2026"
              value={form.prefix}
              onChange={update('prefix')}
            />

            <SelectField
              label="Grant to"
              value={form.granteeType}
              onChange={(e) => setForm({ ...form, granteeType: e.target.value, grantee: '' })}
            >
              <option value="USER">A user (email)</option>
              <option value="GROUP">A group</option>
            </SelectField>

            {form.granteeType === 'USER' ? (
              <TextField label="User email" value={form.grantee} onChange={update('grantee')} isRequired />
            ) : (
              <SelectField label="Group" value={form.grantee} onChange={update('grantee')} isRequired>
                <option value="">Choose a group…</option>
                {[...DATA_GROUPS, ...ALL_ROLES].map((gr) => (
                  <option key={gr}>{gr}</option>
                ))}
              </SelectField>
            )}

            <SelectField label="Level" value={form.level} onChange={update('level')}>
              <option value="Read">Read (view and download)</option>
              <option value="ReadWrite">ReadWrite (+ upload)</option>
              <option value="Full">Full (+ delete)</option>
            </SelectField>

            <TextField label="Reason" value={form.reason} onChange={update('reason')} isRequired />

            <Button type="submit" variation="primary" isLoading={busy}>
              Grant access
            </Button>
          </Flex>
        </form>
      )}

      {/* Current access */}
      <Flex direction="column" gap="0.75rem">
        <Flex justifyContent="space-between" alignItems="center" wrap="wrap" gap="1rem">
          <Heading level={4}>Current access</Heading>
          <Flex alignItems="center" gap="1rem">
            <CheckboxField
              label="Show revoked"
              name="showRevoked"
              checked={showRevoked}
              onChange={(e) => setShowRevoked(e.target.checked)}
            />
            <Button onClick={load} isLoading={loading}>Refresh</Button>
          </Flex>
        </Flex>

        <Table highlightOnHover>
          <TableHead>
            <TableRow>
              <TableCell as="th">Bucket</TableCell>
              <TableCell as="th">Folder</TableCell>
              <TableCell as="th">Granted to</TableCell>
              <TableCell as="th">Level</TableCell>
              <TableCell as="th">Granted by</TableCell>
              <TableCell as="th">Reason</TableCell>
              <TableCell as="th">Status</TableCell>
              <TableCell as="th"></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((g) => (
              <TableRow key={g.id}>
                <TableCell>{g.bucketName}</TableCell>
                <TableCell>{g.prefix || '(whole bucket)'}</TableCell>
                <TableCell>
                  {g.grantee} ({g.granteeType === 'GROUP' ? 'group' : 'user'})
                </TableCell>
                <TableCell>{g.level}</TableCell>
                <TableCell>{g.grantedBy}</TableCell>
                <TableCell>{g.reason}</TableCell>
                <TableCell>
                  <Badge variation={g.status === 'Revoked' ? 'error' : 'success'}>
                    {g.status ?? 'Active'}
                  </Badge>
                  {g.status === 'Revoked' && (
                    <Text fontSize="small">
                      by {g.revokedBy}: {g.revokeReason}
                    </Text>
                  )}
                </TableCell>
                <TableCell>
                  {canManage && g.status !== 'Revoked' && (
                    <Button size="small" variation="destructive" onClick={() => revoke(g)}>
                      Revoke
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {visible.length === 0 && !loading && <Text>No grants to show.</Text>}
      </Flex>
    </Flex>
  );
}
