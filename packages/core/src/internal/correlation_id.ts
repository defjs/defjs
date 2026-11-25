let fallbackSequence = 0;

function formatUuidV4(bytes: Uint8Array): string {
  let result = "";
  bytes.forEach((byte, index) => {
    if (index === 4 || index === 6 || index === 8 || index === 10) {
      result += "-";
    }
    result += byte.toString(16).padStart(2, "0");
  });
  return result;
}

/** Generates a per-call identifier without requiring HTTPS or Node-only APIs. */
export function generateCorrelationId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    view.setUint8(6, (view.getUint8(6) & 0x0f) | 0x40);
    view.setUint8(8, (view.getUint8(8) & 0x3f) | 0x80);
    return formatUuidV4(bytes);
  }
  fallbackSequence = (fallbackSequence + 1) >>> 0;
  return `defjs-${Date.now().toString(36)}-${fallbackSequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
