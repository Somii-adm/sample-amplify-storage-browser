import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ActionHandler } from '@aws-amplify/ui-react-storage/browser';

// Links are signed with the user's 15-minute credentials, so 15 is the real maximum
export const MAX_SHARE_MINUTES = 15;

type ShareLinkHandler = ActionHandler<{ minutes: number }, { link: string }>;

export const shareLinkHandler: ShareLinkHandler = ({ data, config }) => {
  const run = async () => {
    try {
      // Enforce the cap even if the screen sends something else
      const minutes = Math.min(Math.max(Number(data.minutes) || 1, 1), MAX_SHARE_MINUTES);
      const { credentials } = await config.credentials();
      const s3 = new S3Client({ region: config.region, credentials });
      const link = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: config.bucket, Key: data.key }),
        { expiresIn: minutes * 60 }
      );
      return { status: 'COMPLETE' as const, value: { link } };
    } catch (error) {
      return { status: 'FAILED' as const, message: 'Could not create link', error: error as Error };
    }
  };
  return { result: run() };
};
