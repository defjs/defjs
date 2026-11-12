// #region example
import { struct, type Infer } from "@defjs/core";
import { StorageClass } from "./common.ts";

export const ObjectSummary = struct.object({
  key: struct.string(),
  size: struct.number(),
  etag: struct.string(),
  lastModified: struct.date().alias("last_modified"),
  storageClass: StorageClass.alias("storage_class"),
});
export type ObjectSummary = Infer<typeof ObjectSummary>;

export const ListObjectsOutput = struct.object({
  name: struct.string(),
  prefix: struct.string().optional(),
  isTruncated: struct.boolean().alias("is_truncated"),
  nextContinuationToken: struct
    .string()
    .optional()
    .alias("next_continuation_token"),
  contents: struct.array(ObjectSummary),
});
export type ListObjectsOutput = Infer<typeof ListObjectsOutput>;
// #endregion
