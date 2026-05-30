import { storageBucket } from "./admin.js";

const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

type WritableBucket = {
  name: string;
  file(path: string): {
    save(data: Buffer, options: {
      contentType: string;
      cacheControl: string;
      public: boolean;
      resumable: boolean;
    }): Promise<unknown>;
  };
};

export async function uploadPublicJson(
  path: string,
  value: unknown,
  bucket: WritableBucket = storageBucket(),
): Promise<string> {
  const normalizedPath = requirePath(path);
  const data = Buffer.from(JSON.stringify(value, null, 2), "utf8");
  await bucket.file(normalizedPath).save(data, {
    contentType: "application/json",
    cacheControl: IMMUTABLE_CACHE_CONTROL,
    public: true,
    resumable: false,
  });
  return publicStorageUrl(bucket.name, normalizedPath);
}

export async function uploadPublicPng(
  path: string,
  png: Buffer,
  bucket: WritableBucket = storageBucket(),
): Promise<string> {
  const normalizedPath = requirePath(path);
  if (!Buffer.isBuffer(png) || png.length === 0) {
    throw new Error("png must be a non-empty buffer");
  }

  await bucket.file(normalizedPath).save(png, {
    contentType: "image/png",
    cacheControl: IMMUTABLE_CACHE_CONTROL,
    public: true,
    resumable: false,
  });
  return publicStorageUrl(bucket.name, normalizedPath);
}

function requirePath(path: string): string {
  const normalizedPath = path.trim().replace(/^\/+/, "");
  if (!normalizedPath) throw new Error("path is required");
  return normalizedPath;
}

function publicStorageUrl(bucketName: string, path: string): string {
  return `https://storage.googleapis.com/${bucketName}/${path}`;
}
