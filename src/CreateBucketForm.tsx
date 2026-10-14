import { useState, type ChangeEvent, type FormEvent } from 'react';
          
      
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../amplify/data/resource';
import {
  Alert, Button, Flex, Heading, SelectField, TextField,
} from '@aws-amplify/ui-react';

const client = generateClient<Schema>();

const emptyForm = {
  bucketName: '',
  region: 'ap-south-1',
  owner: '',
  costCenter: '',
  businessUnit: '',
  classification: 'Internal',
};

export default function CreateBucketForm() {
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // Returns a function that updates one field of the form
  const update =
    (field: keyof typeof emptyForm) =>
    (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm({ ...form, [field]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault(); // stop the browser reloading the page
    setBusy(true);
    setResult(null);

    const { data, errors } = await client.mutations.createBucket(form);

    if (errors?.length) {
      setResult({ success: false, message: errors[0].message });
    } else {
      setResult(data ?? { success: false, message: 'No response from server.' });
      if (data?.success) setForm(emptyForm);
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit}>
      <Flex direction="column" gap="1rem" maxWidth="32rem">
        <Heading level={3}>Create bucket</Heading>

        <TextField
          label="Bucket name"
          descriptiveText="zifotest-<team>-<purpose>-<dev|test|prod>"
          value={form.bucketName}
          onChange={update('bucketName')}
          isRequired
        />
        <SelectField label="Region" value={form.region} onChange={update('region')}>
          <option value="ap-south-1">Asia Pacific (Mumbai)</option>
        </SelectField>
        <TextField
          label="Owner email"
          value={form.owner}
          onChange={update('owner')}
          isRequired
        />
        <TextField
          label="Cost center"
          value={form.costCenter}
          onChange={update('costCenter')}
          isRequired
        />
        <TextField
          label="Business unit"
          value={form.businessUnit}
          onChange={update('businessUnit')}
          isRequired
        />
        <SelectField
          label="Data classification"
          value={form.classification}
          onChange={update('classification')}
        >
          <option>Public</option>
          <option>Internal</option>
          <option>Confidential</option>
          <option>Restricted</option>
        </SelectField>

        <Button type="submit" variation="primary" isLoading={busy}>
          Create bucket
        </Button>

        {result && (
          <Alert variation={result.success ? 'success' : 'error'}>{result.message}</Alert>
        )}
      </Flex>
    </form>
  );
}
