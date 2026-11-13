// #region example
import { defineRequest, struct, type Infer } from "@defjs/core";
import { ListBucketsOutput } from "../models/bucket.ts";
import { S3Error } from "../models/common.ts";

export const BucketInput = struct.object({
  bucket: struct.string(),
});
export type BucketInput = Infer<typeof BucketInput>;

export const listBuckets = defineRequest({
  meta: { operation: "s3.buckets.list" },
  method: "GET",
  path: "/",
  output: ListBucketsOutput,
  error: S3Error,
});

export const headBucket = defineRequest({
  meta: { operation: "s3.buckets.head" },
  method: "HEAD",
  path: "/:bucket",
  input: BucketInput,
  builder: (input) => ({
    path: { bucket: input.bucket },
  }),
});

export const deleteBucket = defineRequest({
  meta: { operation: "s3.buckets.delete" },
  method: "DELETE",
  path: "/:bucket",
  input: BucketInput,
  builder: (input) => ({
    path: { bucket: input.bucket },
  }),
  error: S3Error,
});
// #endregion
