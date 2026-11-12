// #region example
export { Bucket, ListBucketsOutput } from "./models/bucket.ts";
export { S3Error, StorageClass } from "./models/common.ts";
export { ListObjectsOutput, ObjectSummary } from "./models/object.ts";
export {
  BucketInput,
  deleteBucket,
  headBucket,
  listBuckets,
} from "./services/buckets.ts";
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
} from "./services/objects.ts";
// #endregion
