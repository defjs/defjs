// #region example
import { struct, StructError } from "@defjs/core";

const User = struct.object({ id: struct.number(), name: struct.string() });
const [error, value] = struct.parse(User, { id: "not-a-number" });

if (error) {
  console.log(error instanceof StructError);
  console.log(error.issues[0]?.code, error.issues[0]?.path);
  console.log(error.flatten().fieldErrors);
  console.log(error.format(), error.prettify());
}
void value;
// #endregion
