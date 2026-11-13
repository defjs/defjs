/** Maps a response status to a neutral attempt outcome. */
export function statusOutcome(
  status: number,
): "NET_UNAVAILABLE" | "NET_SERVER_ERROR" | undefined {
  switch (status) {
    case 502:
    case 503:
    case 504:
      return "NET_UNAVAILABLE";
    default:
      return status >= 500 ? "NET_SERVER_ERROR" : undefined;
  }
}
