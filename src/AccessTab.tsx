import { useCallback, useEffect, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import {
  Alert, Badge, Button, Flex,
  Table, TableBody, TableCell, TableHead, TableRow, Text,
} from '@aws-amplify/ui-react';

type AccessGrant = Schema['AccessGrant']['type'];

export default function AccessTab() {
  const [grants, setGrants] = useState<AccessGrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = generateClient<Schema>();
      const { data, errors } = await client.models.AccessGrant.list();
      if (errors?.length) setError(errors[0].message);
      // Group rows by bucket so they're easy to scan
      setGrants([...(data ?? [])].sort((a, b) => a.bucketName.localeCompare(b.bucketName)));
    } catch (err) {
      setError(`Could not load grants: ${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Flex direction="column" gap="1rem" paddingBlock="0.5rem">
      <Flex justifyContent="space-between" alignItems="center">
        <Text>Who can access which bucket. Owners get access automatically.</Text>
        <Button onClick={load} isLoading={loading}>Refresh</Button>
      </Flex>

      {error && <Alert variation="error">{error}</Alert>}

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
          </TableRow>
        </TableHead>
        <TableBody>
          {grants.map((g) => (
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
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {grants.length === 0 && !loading && <Text>No grants yet.</Text>}
    </Flex>
  );
}