/**
 * URLs already published in 11 locales. The regular rule would change them:
 * `ERR_ABORTED` / `ERR_TIMEOUT` are constants, `STRUCT` is a type, and
 * `ClientProvider` is a function.
 */
export const slugExceptions: Readonly<Record<string, string>> = {
  "@defjs/core:ERR_ABORTED": "core/err-aborted-type",
  "@defjs/core:ERR_TIMEOUT": "core/err-timeout-type",
  "@defjs/core:STRUCT": "core/struct-symbol-type",
  "@defjs/react:ClientProvider": "react/clientprovider-type",
};

/** `<package>/<lowercase name>` with `.` and `_` replaced by `-`, plus `-type` for types. */
export function regularSlug(pkg: string, name: string, kind: string): string {
  const short = pkg.startsWith("@defjs/") ? pkg.slice("@defjs/".length) : pkg;
  const base = `${short}/${name.toLowerCase().replaceAll(".", "-").replaceAll("_", "-")}`;
  return kind === "type" ? `${base}-type` : base;
}

export function apiSlug(pkg: string, name: string, kind: string): string {
  return slugExceptions[`${pkg}:${name}`] ?? regularSlug(pkg, name, kind);
}
