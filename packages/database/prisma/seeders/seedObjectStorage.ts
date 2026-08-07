import {
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const DEFAULT_BUCKET = 'bootcamp-media';
const DEFAULT_ENDPOINT = 'http://localhost:9000';
const DEFAULT_REGION = 'us-east-1';
const DEFAULT_ACCESS_KEY = 'bootcamp';
const DEFAULT_SECRET_KEY = 'bootcamp-secret';
const MAX_SEED_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

type MirrorImageOptions = {
  attempts?: number;
  sourceFingerprint?: string;
};

export class SeedObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor() {
    const configuredEndpoint = optionalValue(
      process.env.OBJECT_STORAGE_ENDPOINT,
    );
    const useAwsDefaults =
      !configuredEndpoint && Boolean(process.env.OBJECT_STORAGE_BUCKET);
    const endpoint = useAwsDefaults ? undefined : DEFAULT_ENDPOINT;
    const resolvedEndpoint = configuredEndpoint ?? endpoint;
    const region = process.env.OBJECT_STORAGE_REGION ?? DEFAULT_REGION;
    const accessKeyId = optionalValue(process.env.OBJECT_STORAGE_ACCESS_KEY);
    const secretAccessKey = optionalValue(
      process.env.OBJECT_STORAGE_SECRET_KEY,
    );

    if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
      throw new Error(
        'OBJECT_STORAGE_ACCESS_KEY and OBJECT_STORAGE_SECRET_KEY must be configured together.',
      );
    }

    this.bucket = process.env.OBJECT_STORAGE_BUCKET ?? DEFAULT_BUCKET;
    const configuredPublicUrl = optionalValue(
      process.env.OBJECT_STORAGE_PUBLIC_URL,
    );
    if (!configuredPublicUrl && !resolvedEndpoint) {
      throw new Error(
        'OBJECT_STORAGE_PUBLIC_URL is required when using AWS S3.',
      );
    }
    this.publicBaseUrl = configuredPublicUrl
      ? configuredPublicUrl.replace(/\/+$/, '')
      : `${resolvedEndpoint!.replace(/\/+$/, '')}/${encodeURIComponent(this.bucket)}`;

    const forcePathStyle = optionalValue(
      process.env.OBJECT_STORAGE_FORCE_PATH_STYLE,
    );

    this.client = new S3Client({
      ...(resolvedEndpoint ? { endpoint: resolvedEndpoint } : {}),
      region,
      forcePathStyle: forcePathStyle
        ? forcePathStyle.toLowerCase() === 'true'
        : Boolean(resolvedEndpoint),
      ...(accessKeyId && secretAccessKey
        ? { credentials: { accessKeyId, secretAccessKey } }
        : resolvedEndpoint
          ? {
              credentials: {
                accessKeyId: DEFAULT_ACCESS_KEY,
                secretAccessKey: DEFAULT_SECRET_KEY,
              },
            }
          : {}),
    });
  }

  async assertAvailable(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      throw new Error(
        `Seed object-storage bucket "${this.bucket}" is unavailable: ${errorMessage(error)}`,
      );
    }
  }

  async mirrorImage(
    sourceUrl: string,
    key: string,
    options: MirrorImageOptions = {},
  ): Promise<string> {
    if (await this.objectMatches(key, options.sourceFingerprint)) {
      return this.publicUrl(key);
    }

    const response = await fetchWithRetry(sourceUrl, options.attempts ?? 1);

    const contentType = response.headers
      .get('content-type')
      ?.split(';')[0]
      ?.trim();
    if (!contentType?.startsWith('image/')) {
      throw new Error(
        `Seed image ${sourceUrl} returned unsupported content type "${contentType ?? 'unknown'}".`,
      );
    }

    const declaredSize = Number(response.headers.get('content-length'));
    if (
      Number.isFinite(declaredSize) &&
      declaredSize > MAX_SEED_IMAGE_SIZE_BYTES
    ) {
      throw new Error(`Seed image ${sourceUrl} exceeds the 10 MB limit.`);
    }

    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_SEED_IMAGE_SIZE_BYTES) {
      throw new Error(`Seed image ${sourceUrl} exceeds the 10 MB limit.`);
    }

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentLength: body.length,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
          ...(options.sourceFingerprint
            ? {
                Metadata: {
                  'legacy-source-sha256': options.sourceFingerprint,
                },
              }
            : {}),
        }),
      );
    } catch (error) {
      throw new Error(
        `Failed to upload seed image to ${key}: ${errorMessage(error)}`,
      );
    }

    console.log(`  Uploaded seed image ${key}.`);
    return this.publicUrl(key);
  }

  private async objectMatches(
    key: string,
    sourceFingerprint: string | undefined,
  ): Promise<boolean> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return sourceFingerprint
        ? response.Metadata?.['legacy-source-sha256'] === sourceFingerprint
        : true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw new Error(
        `Failed to inspect seed object ${key}: ${errorMessage(error)}`,
      );
    }
  }

  private publicUrl(key: string): string {
    const encodedKey = key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    return `${this.publicBaseUrl}/${encodedKey}`;
  }
}

async function fetchWithRetry(
  sourceUrl: string,
  attempts: number,
): Promise<Response> {
  const maximumAttempts = Math.max(1, attempts);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const response = await fetch(sourceUrl, {
        headers: {
          'cache-control': 'no-cache',
          'user-agent': 'bootcamp-starter-media-migration/1.0',
        },
        signal: AbortSignal.timeout(60_000),
      });

      if (response.ok) return response;

      lastError = new Error(`HTTP ${response.status}`);
      const retryable = [404, 502, 503, 504].includes(response.status);
      if (!retryable || attempt === maximumAttempts) break;
      await response.body?.cancel();
    } catch (error) {
      lastError = error;
      if (attempt === maximumAttempts) break;
    }

    await delay(Math.min(250 * attempt, 2_000));
  }

  throw new Error(
    `Failed to download seed image ${sourceUrl} after ${maximumAttempts} attempt(s): ${errorMessage(lastError)}`,
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function optionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    candidate.name === 'NotFound' ||
    candidate.name === 'NoSuchKey'
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
