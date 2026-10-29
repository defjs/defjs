export interface MediaTypePrefix {
  essence?: string;
  position: number;
}

const MEDIA_TYPE_ESSENCE =
  /^\s*([\w!#$%&'*+.^`|~-]+)\/([\w!#$%&'*+.^`|~-]+)\s*(?:;|$)/i;

export function parseMediaTypeEssence(value: string): string | undefined {
  const match = value.match(MEDIA_TYPE_ESSENCE);
  if (!match) {
    return undefined;
  }
  return (
    (match as [string, string, string])[1].toLowerCase() +
    "/" +
    (match as [string, string, string])[2].toLowerCase()
  );
}

export function parseMediaTypePrefix(value: string): MediaTypePrefix {
  const trimmedStart = value.trimStart();
  let position = value.length - trimmedStart.length;

  const type = readToken(value, position);
  if (!type || value[type.position] !== "/") {
    return { position: type?.position ?? position };
  }
  position = type.position + 1;

  const subtype = readToken(value, position);
  if (!subtype) {
    return { position };
  }
  position = subtype.position;

  let afterSubtype = position;
  while (value[afterSubtype] === " " || value[afterSubtype] === "\t") {
    afterSubtype += 1;
  }
  while (afterSubtype < value.length && value[afterSubtype]?.trim() === "") {
    afterSubtype += 1;
  }
  if (afterSubtype < value.length && value[afterSubtype] !== ";") {
    return { position };
  }

  return {
    essence: `${type.value.toLowerCase()}/${subtype.value.toLowerCase()}`,
    position,
  };
}

export function isHttpTokenChar(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x21 ||
    code === 0x23 ||
    code === 0x24 ||
    code === 0x25 ||
    code === 0x26 ||
    code === 0x27 ||
    code === 0x2a ||
    code === 0x2b ||
    code === 0x2d ||
    code === 0x2e ||
    code === 0x5e ||
    code === 0x5f ||
    code === 0x60 ||
    code === 0x7c ||
    code === 0x7e
  );
}

function readToken(
  value: string,
  position: number,
): { value: string; position: number } | undefined {
  const start = position;
  while (
    position < value.length &&
    isHttpTokenChar(value.charCodeAt(position))
  ) {
    position += 1;
  }
  return position > start
    ? { value: value.slice(start, position), position }
    : undefined;
}
