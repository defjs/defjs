// #region example
import { struct } from "@defjs/core";

const User = struct.object({
  displayName: struct.string().alias("display_name"),
});

const [parseError, user] = struct.parse(User, { displayName: "Ada" });
if (parseError) throw parseError;
console.log(user.displayName);

const [wireError] = struct.parse(User, { display_name: "Ada" });
console.log(wireError?.issues[0]?.path);
// #endregion
