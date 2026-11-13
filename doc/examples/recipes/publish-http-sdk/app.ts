// #region example
import {
  createClient,
  createHttpInterceptor,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withRetry,
  type DerivableClient,
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

type Report = { etag: string | null; count: number; text: string };

export async function syncReport(
  client: DerivableClient,
): Promise<[Error, undefined] | [null, Report]> {
  const [putErr, , putRes] = await putObject(client, {
    bucket: "assets",
    key: "reports/q1.pdf",
    body: new Blob(["hello-s3-pdf"], { type: "application/pdf" }),
    contentType: "application/pdf",
    storageClass: "STANDARD",
  });
  if (putErr) {
    return [new Error("put object", { cause: putErr }), undefined];
  }

  const [listErr, page] = await listObjectsV2(client, {
    bucket: "assets",
    prefix: "reports/",
    maxKeys: 50,
  });
  if (listErr) {
    return [new Error("list objects", { cause: listErr }), undefined];
  }

  const [getErr, blob] = await getObject(
    client({ signal: AbortSignal.timeout(10_000) }),
    { bucket: "assets", key: "reports/q1.pdf" },
  );
  if (getErr) {
    return [new Error("get object", { cause: getErr }), undefined];
  }

  return [
    null,
    {
      etag: putRes.headers.get("etag"),
      count: page.contents.length,
      text: await blob.text(),
    },
  ];
}

async function main() {
  const [err, report] = await syncReport(s3Client);
  if (err) {
    console.error(err);
    return;
  }
  console.log(report.etag, report.count, report.text);
}

void main();
// #endregion
