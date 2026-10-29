// #region example
import { struct } from "@defjs/core";

const Any = struct.any();
const ArrayOfStrings = struct.array(struct.string());
const Bytes = struct.arrayBuffer();
const BigIntValue = struct.bigint();
const BlobValue = struct.blob();
const BooleanValue = struct.boolean();
const DateValue = struct.date();
const Discriminated = struct.discriminatedUnion("kind", [
  struct.object({ kind: struct.literal("created"), id: struct.number() }),
  struct.object({ kind: struct.literal("deleted"), id: struct.number() }),
]);
const Status = struct.enum(["draft", "published"]);
const FileValue = struct.file();
const Form = struct.formData({ file: struct.file() });
const Combined = struct.intersection(
  struct.object({ id: struct.number() }),
  struct.object({ name: struct.string() }),
);
const Literal = struct.literal("ready");
const NullValue = struct.null();
const NumberValue = struct.number();
const ObjectValue = struct.object({ id: struct.number() });
const Union = struct.or(struct.string(), struct.number());
const RecordValue = struct.record(struct.number());
const StringValue = struct.string();
const Tuple = struct.tuple([struct.string(), struct.number()]);
const Unknown = struct.unknown();
const FormUrlEncoded = struct.urlencoded({ name: struct.string() });

void [
  Any,
  ArrayOfStrings,
  Bytes,
  BigIntValue,
  BlobValue,
  BooleanValue,
  DateValue,
  Discriminated,
  Status,
  FileValue,
  Form,
  Combined,
];
void [
  Literal,
  NullValue,
  NumberValue,
  ObjectValue,
  Union,
  RecordValue,
  StringValue,
  Tuple,
  Unknown,
  FormUrlEncoded,
];
// #endregion
