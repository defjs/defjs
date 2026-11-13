// #region example
import { struct, StructError } from "@defjs/core";

const Order = struct.object({ id: struct.number(), status: struct.string() });
const [err] = struct.parse(Order, { id: "not-a-number" });

if (err) {
  console.log(err instanceof StructError);
  console.log(err.issues[0]?.code, err.issues[0]?.path);
  console.log(err.flatten().fieldErrors);
  console.log(err.format(), err.prettify());
}
// #endregion
