const MEDIA_TYPE_ESSENCE =
  /^\s*([\w!#$%&'*+.^`|~-]+)\/([\w!#$%&'*+.^`|~-]+)\s*(?:;|$)/i;

export function parseMediaTypeEssence(value: string): string | undefined {
  const match = value.match(MEDIA_TYPE_ESSENCE);
  if (!match) {
    return undefined;
  }
  // A match always has both captures: the type and the subtype.
  return match.slice(1, 3).join("/").toLowerCase();
}
