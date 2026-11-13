// #region example
export { Bucket, ListBucketsOutput } from "./schema/bucket.ts";
export { S3Error, StorageClass } from "./schema/common.ts";
export { ListObjectsOutput, ObjectSummary } from "./schema/object.ts";
export {
  BucketInput,
  deleteBucket,
  headBucket,
  listBuckets,
} from "./request/buckets.ts";
export {
  deleteObject,
  GetObjectInput,
  getObject,
  headObject,
  ListObjectsInput,
  listObjectsV2,
  ObjectKeyInput,
  PutObjectInput,
  putObject,
} from "./request/objects.ts";
// #endregion
