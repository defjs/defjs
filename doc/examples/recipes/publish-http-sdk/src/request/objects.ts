// #region example
import { defineRequest, struct, type Infer } from "@defjs/core";
import { S3Error, StorageClass } from "../schema/common.ts";
import { ListObjectsOutput } from "../schema/object.ts";

export const ListObjectsInput = struct.object({
  bucket: struct.string(),
  prefix: struct.string().optional(),
  continuationToken: struct.string().optional(),
  maxKeys: struct.number().optional(),
});
export type ListObjectsInput = Infer<typeof ListObjectsInput>;

export const listObjectsV2 = defineRequest({
  meta: { operation: "s3.objects.listV2" },
  method: "GET",
  path: "/:bucket",
  input: ListObjectsInput,
  builder: (input) => ({
    path: { bucket: input.bucket },
    query: {
      "list-type": 2,
      prefix: input.prefix,
      "continuation-token": input.continuationToken,
      "max-keys": input.maxKeys,
    },
  }),
  output: ListObjectsOutput,
  error: S3Error,
});

export const ObjectKeyInput = struct.object({
  bucket: struct.string(),
  key: struct.string(),
});
export type ObjectKeyInput = Infer<typeof ObjectKeyInput>;

export const headObject = defineRequest({
  meta: { operation: "s3.objects.head" },
  method: "HEAD",
  path: "/:bucket/:key",
  input: ObjectKeyInput,
  builder: (input) => ({
    path: { bucket: input.bucket, key: input.key },
  }),
});

export const GetObjectInput = struct.object({
  bucket: struct.string(),
  key: struct.string(),
  ifNoneMatch: struct.string().optional(),
});
export type GetObjectInput = Infer<typeof GetObjectInput>;

export const getObject = defineRequest({
  meta: { operation: "s3.objects.get" },
  method: "GET",
  path: "/:bucket/:key",
  input: GetObjectInput,
  builder: (input) => ({
    path: { bucket: input.bucket, key: input.key },
    headers: { "if-none-match": input.ifNoneMatch },
  }),
  output: struct.blob(),
  error: S3Error,
});

export const PutObjectInput = struct.object({
  bucket: struct.string(),
  key: struct.string(),
  body: struct.blob(),
  contentType: struct.string().optional(),
  storageClass: StorageClass.optional(),
});
export type PutObjectInput = Infer<typeof PutObjectInput>;

export const putObject = defineRequest({
  meta: { operation: "s3.objects.put" },
  method: "PUT",
  path: "/:bucket/:key",
  input: PutObjectInput,
  builder: (input) => ({
    path: { bucket: input.bucket, key: input.key },
    headers: {
      "content-type": input.contentType,
      "x-amz-storage-class": input.storageClass,
    },
    body: input.body,
  }),
  error: S3Error,
});

export const deleteObject = defineRequest({
  meta: { operation: "s3.objects.delete" },
  method: "DELETE",
  path: "/:bucket/:key",
  input: ObjectKeyInput,
  builder: (input) => ({
    path: { bucket: input.bucket, key: input.key },
  }),
  error: S3Error,
});
// #endregion
