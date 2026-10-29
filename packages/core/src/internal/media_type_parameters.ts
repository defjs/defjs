import { parseMediaTypeEssence, parseMediaTypePrefix } from "./media_type";

const MEDIA_TYPE_PARAMETERS =
  /^(?:[ \t]*;[ \t]*[!#$%&'*+\-.^_`|~0-9A-Za-z]+[ \t]*=[ \t]*(?:"(?:[\t\x20\x21\x23-\x5B\x5D-\x7E\x80-\uFFFF]|\\[\t\x20\x21-\x7E\x80-\uFFFF])*"|[!#$%&'*+\-.^_`|~0-9A-Za-z]+))*[ \t]*$/;

export interface ParsedMediaType {
  essence?: string;
  parametersWellFormed: boolean;
}

export function parseMediaType(value: string): ParsedMediaType {
  const essence = parseMediaTypeEssence(value);
  return {
    essence,
    parametersWellFormed: isMediaTypeParametersWellFormed(value),
  };
}

export function isMediaTypeParametersWellFormed(value: string): boolean {
  const prefix = parseMediaTypePrefix(value);
  return (
    !!prefix.essence &&
    value.trimStart() === value &&
    MEDIA_TYPE_PARAMETERS.test(value.slice(prefix.position))
  );
}
