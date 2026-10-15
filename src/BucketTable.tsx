import { Fragment, useMemo, useState } from 'react';
          
      
import type { Schema } from '../amplify/data/resource';
import {
  Badge, Button, Flex, SearchField, SelectField,
  Table, TableBody, TableCell, TableHead, TableRow, Text,
} from '@aws-amplify/ui-react';

type BucketRecord = Schema['BucketRecord']['type'];
type SortKey =
  | 'bucketName' | 'businessUnit' | 'costCenter'
  | 'owner' | 'classification' | 'createdAt';

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'bucketName', label: 'Bucket' },
  { key: 'businessUnit', label: 'Business unit' },
  { key: 'costCenter', label: 'Cost center' },
  { key: 'owner', label: 'Owner' },
  { key: 'classification', label: 'Classification' },
  { key: 'createdAt', label: 'Created' },
];

// Records from before today have no status; treat them as Active
const isDeleted = (b: BucketRecord) => b.status === 'Deleted';

// Distinct, sorted values for a filter dropdown
const unique = (values: (string | null | undefined)[]) =>
  [...new Set(values.filter((v): v is string => !!v))].sort();

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <Text>
      <strong>{label}:</strong> {value || '—'}
    </Text>
  );
}

export default function BucketTable({
  buckets,
  onDelete,
  canDelete,
}: {
  buckets: BucketRecord[];
  onDelete: (bucket: BucketRecord) => void;
  canDelete: boolean;
}) {
  const [search, setSearch] = useState('');
  const [bu, setBu] = useState('');
  const [costCenter, setCostCenter] = useState('');
  const [status, setStatus] = useState('Active');
  const [sortKey, setSortKey] = useState<SortKey>('createdAt');
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Recalculate the visible rows whenever data, filters or sorting change
  const rows = useMemo(() => {
    const q = search.toLowerCase();
    return buckets
      .filter((b) => status === 'All' || (status === 'Deleted') === isDeleted(b))
      .filter((b) => !bu || b.businessUnit === bu)
      .filter((b) => !costCenter || b.costCenter === costCenter)
      .filter(
        (b) =>
          !q ||
          b.bucketName.toLowerCase().includes(q) ||
          (b.owner ?? '').toLowerCase().includes(q)
      )
      .sort((a, b) => {
        const x = String(a[sortKey] ?? '');
        const y = String(b[sortKey] ?? '');
        return sortAsc ? x.localeCompare(y) : y.localeCompare(x);
      });
  }, [buckets, search, bu, costCenter, status, sortKey, sortAsc]);

  function sortBy(key: SortKey) {
    if (key === sortKey) {
      setSortAsc(!sortAsc); // same column: flip direction
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  return (
    <Flex direction="column" gap="1rem">
      {/* Filters */}
      <Flex wrap="wrap" gap="1rem" alignItems="flex-end">
        <SearchField
          label="Search"
          placeholder="Bucket or owner"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch('')}
        />
        <SelectField label="Business unit" value={bu} onChange={(e) => setBu(e.target.value)}>
          <option value="">All</option>
          {unique(buckets.map((b) => b.businessUnit)).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </SelectField>
        <SelectField
          label="Cost center"
          value={costCenter}
          onChange={(e) => setCostCenter(e.target.value)}
        >
          <option value="">All</option>
          {unique(buckets.map((b) => b.costCenter)).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </SelectField>
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option>Active</option>
          <option>Deleted</option>
          <option>All</option>
        </SelectField>
      </Flex>

      <Table highlightOnHover>
        <TableHead>
          <TableRow>
            {COLUMNS.map((c) => (
              <TableCell
                as="th"
                key={c.key}
                onClick={() => sortBy(c.key)}
                style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                {c.label}
                {sortKey === c.key ? (sortAsc ? ' ▲' : ' ▼') : ''}
              </TableCell>
            ))}
            <TableCell as="th">Status</TableCell>
            <TableCell as="th"></TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((b) => (
            <Fragment key={b.id}>
              {/* Main row: click to expand */}
              <TableRow
                onClick={() => setExpandedId(expandedId === b.id ? null : b.id)}
                style={{ cursor: 'pointer' }}
              >
                <TableCell>{b.bucketName}</TableCell>
                <TableCell>{b.businessUnit}</TableCell>
                <TableCell>{b.costCenter}</TableCell>
                <TableCell>{b.owner}</TableCell>
                <TableCell>{b.classification}</TableCell>
                <TableCell>{new Date(b.createdAt).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Badge variation={isDeleted(b) ? 'error' : 'success'}>
                    {isDeleted(b) ? 'Deleted' : 'Active'}
                  </Badge>
                </TableCell>
                <TableCell>
                  {canDelete &&!isDeleted(b) && (
                    <Button
                      size="small"
                      variation="destructive"
                      onClick={(e) => {
                        e.stopPropagation(); // don't also expand the row
                        onDelete(b);
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </TableCell>
              </TableRow>

              {/* Expanded details */}
              {expandedId === b.id && (
                <TableRow>
                  <TableCell colSpan={COLUMNS.length + 2}>
                    <Flex direction="column" gap="0.25rem">
                      <Text fontWeight="bold">Tags</Text>
                      <Detail label="Owner" value={b.owner} />
                      <Detail label="CostCenter" value={b.costCenter} />
                      <Detail label="BusinessUnit" value={b.businessUnit} />
                      <Detail label="DataClassification" value={b.classification} />
                      <Detail label="CreatedBy" value={b.createdBy} />
                      <Detail label="ManagedBy" value="s3-portal" />
                      <Detail label="Region" value={b.region} />
                      <Detail label="Created" value={new Date(b.createdAt).toLocaleString()} />
                      {isDeleted(b) && (
                        <>
                          <Text fontWeight="bold" marginTop="0.5rem">Deletion</Text>
                          <Detail label="Deleted by" value={b.deletedBy} />
                          <Detail
                            label="Deleted on"
                            value={b.deletedAt ? new Date(b.deletedAt).toLocaleString() : null}
                          />
                          <Detail label="Reason" value={b.deleteReason} />
                        </>
                      )}
                    </Flex>
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
        </TableBody>
      </Table>

      {rows.length === 0 && <Text>No buckets match these filters.</Text>}
    </Flex>
  );
}