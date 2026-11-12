// #region example
import { struct, type Struct } from "@defjs/core";

interface Category {
  name: string;
  children: Category[];
}

const CategoryStruct: Struct<Category> = struct.object({
  name: struct.string(),
  get children() {
    return struct.array(CategoryStruct);
  },
});

const [error, tree] = struct.parse(CategoryStruct, {
  name: "tools",
  children: [{ name: "hammers", children: [] }],
});

if (!error) console.log(tree.children[0]?.name);
// #endregion
