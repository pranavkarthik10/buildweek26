import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getObject, isObjectStorageConfigured, putObject } from "@/lib/object-storage";

const CACHE_ROOT = path.join(process.cwd(), ".aiprof-cache", "model-outputs");
const MAX_CACHE_ENTRY_BYTES = 32 * 1024 * 1024;
const inFlight = new Map<string, Promise<unknown>>();

export function modelOutputCacheKey(namespace: string, input: unknown) {
  return createHash("sha256")
    .update(`${namespace}\u0000${stableStringify(input)}`)
    .digest("hex");
}

export async function readModelOutput<T>(input: {
  namespace: string;
  key: string;
  validate: (value: unknown) => value is T;
}): Promise<T | null> {
  const local = await readLocal(input.namespace, input.key);
  if (local !== null) {
    if (input.validate(local)) return local;
    await rm(localPath(input.namespace, input.key), { force: true }).catch(() => undefined);
  }
  if (!isObjectStorageConfigured()) return null;

  try {
    const buffer = await getObject(objectKey(input.namespace, input.key));
    if (buffer.byteLength > MAX_CACHE_ENTRY_BYTES) return null;
    const parsed = JSON.parse(buffer.toString("utf8")) as unknown;
    if (!input.validate(parsed)) return null;
    await writeLocal(input.namespace, input.key, buffer).catch(() => undefined);
    return parsed;
  } catch {
    return null;
  }
}

export async function writeModelOutput(input: {
  namespace: string;
  key: string;
  value: unknown;
}) {
  const buffer = Buffer.from(JSON.stringify(input.value));
  if (buffer.byteLength > MAX_CACHE_ENTRY_BYTES) return false;

  const writes: Promise<unknown>[] = [writeLocal(input.namespace, input.key, buffer)];
  if (isObjectStorageConfigured()) {
    writes.push(putObject({
      key: objectKey(input.namespace, input.key),
      body: buffer,
      contentType: "application/json",
    }));
  }
  const results = await Promise.allSettled(writes);
  for (const result of results) {
    if (result.status === "rejected") console.warn("[studydeck] model cache write failed", result.reason);
  }
  return results.some((result) => result.status === "fulfilled");
}

export async function getOrCreateModelOutput<T>(input: {
  namespace: string;
  key: string;
  validate: (value: unknown) => value is T;
  create: () => Promise<T>;
}) {
  const cached = await readModelOutput(input);
  if (cached !== null) return { value: cached, cacheHit: true };

  const flightKey = `${input.namespace}:${input.key}`;
  const existing = inFlight.get(flightKey) as Promise<T> | undefined;
  if (existing) return { value: await existing, cacheHit: true };

  const promise = input.create();
  inFlight.set(flightKey, promise);
  try {
    const value = await promise;
    await writeModelOutput({ namespace: input.namespace, key: input.key, value });
    return { value, cacheHit: false };
  } finally {
    if (inFlight.get(flightKey) === promise) inFlight.delete(flightKey);
  }
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

async function readLocal(namespace: string, key: string) {
  try {
    const buffer = await readFile(localPath(namespace, key));
    if (buffer.byteLength > MAX_CACHE_ENTRY_BYTES) return null;
    return JSON.parse(buffer.toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

async function writeLocal(namespace: string, key: string, buffer: Buffer) {
  const target = localPath(namespace, key);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, buffer);
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    const existing = await readFile(target).catch(() => null);
    if (!existing) throw error;
  }
}

function safeNamespace(namespace: string) {
  return namespace.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

function localPath(namespace: string, key: string) {
  return path.join(CACHE_ROOT, safeNamespace(namespace), `${key}.json`);
}

function objectKey(namespace: string, key: string) {
  return `model-cache/${safeNamespace(namespace)}/${key}.json`;
}
