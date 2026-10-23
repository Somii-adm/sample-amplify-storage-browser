import { useMemo, useState } from 'react';
import { Alert, Button, Flex, Link, StepperField, Text } from '@aws-amplify/ui-react';
import { useAction, useView } from './storageBrowser';
import { MAX_SHARE_MINUTES } from './shareLinkHandler';

export function ShareLinkView() {
  const [minutes, setMinutes] = useState(MAX_SHARE_MINUTES);
  const { onActionExit, fileDataItems } = useView('LocationDetail');

  // The selected files, each tagged with the chosen expiry
  const items = useMemo(
    () => (fileDataItems ?? []).map((item) => ({ ...item, minutes })),
    [fileDataItems, minutes]
  );
  const [{ tasks }, generate] = useAction('shareLink', { items });

  return (
    <Flex direction="column" gap="1rem" padding="1rem">
      <Text fontWeight="bold">Share links</Text>
      <Alert variation="warning">
        Anyone with a link can download that file until it expires. Links last at most{' '}
        {MAX_SHARE_MINUTES} minutes.
      </Alert>

      <StepperField
        label="Link valid for (minutes)"
        min={1}
        max={MAX_SHARE_MINUTES}
        step={1}
        value={minutes}
        onStepChange={setMinutes}
      />

      <Flex gap="0.5rem">
        <Button variation="primary" onClick={() => generate()}>Generate links</Button>
        <Button onClick={onActionExit}>Back</Button>
      </Flex>

      {tasks?.map(({ data, status, value }) => (
        <Flex key={data.id} direction="column" gap="0.25rem">
          <Text>
            {data.key}: {status}
          </Text>
          {value?.link && (
            <Flex gap="0.5rem" alignItems="center">
              <Link href={value.link} isExternal>Open</Link>
              <Button size="small" onClick={() => navigator.clipboard.writeText(value.link)}>
                Copy link
              </Button>
            </Flex>
          )}
        </Flex>
      ))}
    </Flex>
  );
}
