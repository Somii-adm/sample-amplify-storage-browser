import { useCallback, useEffect, useState } from 'react';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import { Alert, Button, Flex, Tabs } from '@aws-amplify/ui-react';
import CreateBucketForm from './CreateBucketForm';
import BucketTable from './BucketTable';
import { CAN_MANAGE_BUCKETS, inAnyGroup } from '../amplify/roles';
import AccessTab from './AccessTab';

type BucketRecord = Schema['BucketRecord']['type'];

export default function AdminPage({ groups }: { groups: string[] }) {
  const canManageBuckets = inAnyGroup(groups, CAN_MANAGE_BUCKETS);
  const [tab, setTab] = useState(canManageBuckets ? 'create' : 'buckets');
  const [buckets, setBuckets] = useState<BucketRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

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
    const typed = window.prompt(
      `This permanently deletes ${bucket.bucketName}.\nType the bucket name to confirm:`
    );
    if (typed === null) return; // cancelled
    if (typed !== bucket.bucketName) {
      setResult({ success: false, message: 'Name did not match. Nothing was deleted.' });
      return;
    }

    const reason = window.prompt('Why is this bucket being deleted? (recorded for audit)');
    if (reason === null) return;
    if (reason.trim().length < 5) {
      setResult({ success: false, message: 'A reason (5+ characters) is required. Nothing was deleted.' });
      return;
    }

    try {
      const client = generateClient<Schema>();
      const { data, errors } = await client.mutations.deleteBucket({
        bucketName: bucket.bucketName,
        region: bucket.region ?? 'ap-south-1',
        recordId: bucket.id,
        reason: reason.trim(),
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
    <Flex direction="column" gap="1rem" padding="1rem">
      {result && (
        <Alert
          variation={result.success ? 'success' : 'error'}
          isDismissible
          onDismiss={() => setResult(null)}
        >
          {result.message}
        </Alert>
      )}

      <Tabs.Container value={tab} onValueChange={setTab}>
        <Tabs.List>
          {canManageBuckets && <Tabs.Item value="create">Create bucket</Tabs.Item>}
          <Tabs.Item value="buckets">Managed buckets</Tabs.Item>
          <Tabs.Item value="access">Access</Tabs.Item>
        </Tabs.List>

        {canManageBuckets && (
          <Tabs.Panel value="create">
            <CreateBucketForm onCreated={loadBuckets} />
          </Tabs.Panel>
        )}

        <Tabs.Panel value="buckets">
          <Flex justifyContent="flex-end" paddingBlock="0.5rem">
            <Button onClick={loadBuckets} isLoading={loading}>Refresh</Button>
          </Flex>
          <BucketTable buckets={buckets} onDelete={remove} canDelete={canManageBuckets} />
        </Tabs.Panel>
        
        <Tabs.Panel value="access">
          <AccessTab />
        </Tabs.Panel>
      </Tabs.Container>
    </Flex>
  );
}
