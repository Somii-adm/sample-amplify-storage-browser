import { useCallback, useEffect, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import {
  Alert, Button, Flex, Heading,
  Table, TableBody, TableCell, TableHead, TableRow,
} from '@aws-amplify/ui-react';
import CreateBucketForm from './CreateBucketForm';

type BucketRecord = Schema['BucketRecord']['type'];

export default function AdminPage() {
  const [buckets, setBuckets] = useState<BucketRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // Load the list of portal-managed buckets
  const loadBuckets = useCallback(async () => {
    setLoading(true);
    try {
      const client = generateClient<Schema>();
      const { data, errors } = await client.models.BucketRecord.list();
      if (errors?.length) setResult({ success: false, message: errors[0].message });
      setBuckets(data ?? []);
    } catch (err) {
      setResult({ success: false, message: `Could not load buckets: ${String(err)}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBuckets();
  }, [loadBuckets]);

  async function remove(bucket: BucketRecord) {
    // Make the admin type the name, so nobody deletes the wrong bucket by accident
    const typed = window.prompt(
      `This permanently deletes ${bucket.bucketName}.\nType the bucket name to confirm:`
    );
    if (typed !== bucket.bucketName) return;

    try {
      const client = generateClient<Schema>();
      const { data, errors } = await client.mutations.deleteBucket({
        bucketName: bucket.bucketName,
        region: bucket.region ?? 'ap-south-1',
        recordId: bucket.id,
      });
      setResult(
        errors?.length
          ? { success: false, message: errors[0].message }
          : data ?? { success: false, message: 'No response from server.' }
      );
    } catch (err) {
      setResult({ success: false, message: `Unexpected error: ${String(err)}` });
    }
    loadBuckets();
  }

  return (
    <Flex direction="column" gap="2rem" padding="1rem">
      <CreateBucketForm onCreated={loadBuckets} />

      <Flex direction="column" gap="1rem">
        <Flex justifyContent="space-between" alignItems="center">
          <Heading level={3}>Portal buckets</Heading>
          <Button onClick={loadBuckets} isLoading={loading}>Refresh</Button>
        </Flex>

        {result && (
          <Alert variation={result.success ? 'success' : 'error'}>{result.message}</Alert>
        )}

        <Table highlightOnHover>
          <TableHead>
            <TableRow>
              <TableCell as="th">Bucket</TableCell>
              <TableCell as="th">Owner</TableCell>
              <TableCell as="th">Classification</TableCell>
              <TableCell as="th">Created by</TableCell>
              <TableCell as="th">Created</TableCell>
              <TableCell as="th"></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {buckets.map((b) => (
              <TableRow key={b.id}>
                <TableCell>{b.bucketName}</TableCell>
                <TableCell>{b.owner}</TableCell>
                <TableCell>{b.classification}</TableCell>
                <TableCell>{b.createdBy}</TableCell>
                <TableCell>{new Date(b.createdAt).toLocaleString()}</TableCell>
                <TableCell>
                  <Button size="small" variation="destructive" onClick={() => remove(b)}>
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {buckets.length === 0 && !loading && <p>No portal-managed buckets yet.</p>}
      </Flex>
    </Flex>
  );
}
