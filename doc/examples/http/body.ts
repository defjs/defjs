// #region example
import { defineRequest, struct } from "@defjs/core";

const login = defineRequest({
  method: "POST",
  path: "/login",
  input: struct.object({
    form: struct.urlencoded({
      userName: struct.string().alias("username"),
      password: struct.string(),
    }),
  }),
  builder: (input) => ({ body: input.form }),
});

const upload = defineRequest({
  method: "POST",
  path: "/files/:id",
  input: struct.object({
    id: struct.string(),
    photos: struct.array(struct.file()),
  }),
  builder: (input) => {
    const body = new FormData();
    input.photos.forEach((photo, index) =>
      body.append("photo", photo, `photo-${index}.jpg`),
    );
    return { path: { id: input.id }, body };
  },
});

void login;
void upload;
// #endregion
