// #region example
import { struct, type Infer } from "@defjs/core";

export const StorageClass = struct.enum([
  "STANDARD",
  "INTELLIGENT_TIERING",
  "GLACIER",
] as const);
export type StorageClass = Infer<typeof StorageClass>;

export const S3Error = struct.object({
  code: struct.string(),
  message: struct.string(),
  resource: struct.string().optional(),
  requestId: struct.string().optional().alias("request_id"),
});
export type S3Error = Infer<typeof S3Error>;
// #endregion
