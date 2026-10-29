// #region example
import { struct } from "@defjs/core";

const User = struct.object({
  displayName: struct.string().alias("display_name"),
});

function readDisplayName() {
  const [parseError, user] = struct.parse(User, { displayName: "Ada" });
  if (parseError) {
    console.error(parseError.message);
    return;
  }
  console.log(user.displayName);
}

readDisplayName();

const [wireError] = struct.parse(User, { display_name: "Ada" });
// Expected failure: public parse reads logical keys, not wire keys.
if (!wireError) throw new Error("struct.parse must read logical keys");
console.log(wireError.issues[0]?.path);
// #endregion
