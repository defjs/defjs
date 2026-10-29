// #region example
import { struct } from "@defjs/core";

const Profile = struct.object({
  name: struct.string(),
  nickname: struct.string().optional(),
  biography: struct.string().null(),
  note: struct.string().nullish(),
});

function showProfile() {
  const [error, profile] = struct.parse(Profile, {
    name: "Ada",
    biography: null,
    note: undefined,
  });
  if (error) {
    console.error(error.message);
    return;
  }
  console.log(profile.name, profile.nickname, profile.biography, profile.note);
}

showProfile();
// #endregion
