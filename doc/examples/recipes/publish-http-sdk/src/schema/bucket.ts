// #region example
import { struct, type Infer } from "@defjs/core";

export const Bucket = struct.object({
  name: struct.string(),
  creationDate: struct.date().alias("creation_date"),
});
export type Bucket = Infer<typeof Bucket>;

export const ListBucketsOutput = struct.object({
  buckets: struct.array(Bucket),
});
export type ListBucketsOutput = Infer<typeof ListBucketsOutput>;
// #endregion
