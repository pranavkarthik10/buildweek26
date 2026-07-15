import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicBaseUrl: string;
};

let client: S3Client | null = null;

function getR2Config(): R2Config | null {
  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME,
    R2_PUBLIC_BASE_URL,
  } = process.env;

  if (
    !R2_ACCOUNT_ID ||
    !R2_ACCESS_KEY_ID ||
    !R2_SECRET_ACCESS_KEY ||
    !R2_BUCKET_NAME ||
    !R2_PUBLIC_BASE_URL
  ) {
    return null;
  }

  return {
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucketName: R2_BUCKET_NAME,
    publicBaseUrl: R2_PUBLIC_BASE_URL.replace(/\/$/, ""),
  };
}

export function isObjectStorageConfigured() {
  return getR2Config() !== null;
}

export function objectUrlForKey(key: string) {
  const config = getR2Config();
  if (!config) return null;
  return `${config.publicBaseUrl}/${key}`;
}

export async function putObject({
  key,
  body,
  contentType,
}: {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
}) {
  const config = getR2Config();
  if (!config) {
    throw new Error("Cloudflare R2 is not configured.");
  }

  client ??= new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}
