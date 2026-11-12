// #region example
import {
  createClient,
  createHttpInterceptor,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withRetry,
  type FetchHandle,
} from "@defjs/core";
import { getObject, listObjectsV2, putObject } from "./src/index.ts";

const handle: FetchHandle = (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (request.method === "PUT") {
    return Promise.resolve(
      new Response(null, {
        status: 200,
        headers: { etag: '"etag-report-v1"' },
      }),
    );
  }
  if (url.searchParams.get("list-type") === "2") {
    return Promise.resolve(
      Response.json({
        name: "assets",
        prefix: "reports/",
        is_truncated: false,
        contents: [
          {
            key: "reports/q1.pdf",
            size: 12,
            etag: '"etag-report-v1"',
            last_modified: "2026-02-01T12:00:00.000Z",
            storage_class: "STANDARD",
          },
        ],
      }),
    );
  }
  return Promise.resolve(
    new Response(new Blob(["hello-s3-pdf"], { type: "application/pdf" }), {
      status: 200,
      headers: {
        etag: '"etag-report-v1"',
        "content-type": "application/pdf",
      },
    }),
  );
};

const s3AuthInterceptor = createHttpInterceptor((request, next) => {
  const headers = new Headers(request.headers);
  headers.set("x-amz-date", "20260201T120000Z");
  headers.set("authorization", "AWS4-HMAC-SHA256 Credential=akid/...");
  return next({ ...request, headers });
});

const s3Client = createClient(
  withEndpoint("https://s3.us-east-1.amazonaws.com"),
  withInterceptors(s3AuthInterceptor),
  withRetry({ maxRetries: 3 }),
  withHTTPHandle(handle),
);

async function main() {
  const [putErr, , putRes] = await putObject(s3Client, {
    bucket: "assets",
    key: "reports/q1.pdf",
    body: new Blob(["hello-s3-pdf"], { type: "application/pdf" }),
    contentType: "application/pdf",
    storageClass: "STANDARD",
  });
  if (putErr) {
    if (putErr.code === "HTTP_STATUS") {
      console.error(putErr.data.code, putErr.data.requestId);
    }
    return;
  }

  const [listErr, page] = await listObjectsV2(s3Client, {
    bucket: "assets",
    prefix: "reports/",
    maxKeys: 50,
  });
  if (listErr) {
    console.error(listErr.code);
    return;
  }

  const [getErr, blob] = await getObject(
    s3Client({ signal: AbortSignal.timeout(10_000) }),
    {
      bucket: "assets",
      key: "reports/q1.pdf",
      ifNoneMatch: putRes.headers.get("etag") ?? undefined,
    },
  );
  if (getErr) {
    console.error(getErr.code);
    return;
  }

  console.log(
    putRes.headers.get("etag"),
    page.contents.length,
    await blob.text(),
  );
}

void main();
// #endregion
