// #region example
import { struct, StructError } from "@defjs/core";

const Order = struct.object({ id: struct.number(), status: struct.string() });
const [error] = struct.parse(Order, { id: "not-a-number" });

if (error) {
  console.log(error instanceof StructError);
  console.log(error.issues[0]?.code, error.issues[0]?.path);
  console.log(error.flatten().fieldErrors);
  console.log(error.format(), error.prettify());
}
// #endregion
