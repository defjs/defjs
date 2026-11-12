import {
  createClient,
  withEndpoint,
  withHeaders,
  withHTTPHandle,
  type FetchHandle,
} from "@defjs/core";
import { expect, test } from "vitest";
import {
  deleteBucket,
  deleteObject,
  getObject,
  headBucket,
  headObject,
  listBuckets,
  listObjectsV2,
  putObject,
} from "./src/index.ts";

test("pure S3 SDK operation functions isolate client endpoints/headers and map path, query, headers, binary bodies, and typed S3Error", async () => {
  const recorded: {
    method: string;
    url: string;
    authorization: string | null;
    contentType: string | null;
    storageClass: string | null;
    ifNoneMatch: string | null;
  }[] = [];

  const handle: FetchHandle = (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    recorded.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.get("authorization"),
      contentType: request.headers.get("content-type"),
      storageClass: request.headers.get("x-amz-storage-class"),
      ifNoneMatch: request.headers.get("if-none-match"),
    });

    if (url.hostname === "r2.example.test") {
      return Promise.resolve(
        Response.json(
          {
            code: "NoSuchKey",
            message: "The specified key does not exist.",
            resource: url.pathname,
            request_id: "req-404",
          },
          { status: 404 },
        ),
      );
    }

    if (request.method === "GET" && url.pathname === "/") {
      return Promise.resolve(
        Response.json({
          buckets: [
            { name: "assets", creation_date: "2026-01-15T00:00:00.000Z" },
          ],
        }),
      );
    }

    if (request.method === "PUT" && url.pathname === "/assets/report.pdf") {
      return Promise.resolve(
        new Response(null, {
          status: 200,
          headers: { etag: '"etag-report-v1"' },
        }),
      );
    }

    if (request.method === "GET" && url.pathname === "/assets") {
      return Promise.resolve(
        Response.json({
          name: "assets",
          prefix: "reports/",
          is_truncated: false,
          contents: [
            {
              key: "report.pdf",
              size: 12,
              etag: '"etag-report-v1"',
              last_modified: "2026-02-01T12:00:00.000Z",
              storage_class: "STANDARD",
            },
          ],
        }),
      );
    }

    if (request.method === "HEAD" && url.pathname === "/assets/report.pdf") {
      return Promise.resolve(
        new Response(null, {
          status: 200,
          headers: {
            etag: '"etag-report-v1"',
            "content-length": "12",
          },
        }),
      );
    }

    if (request.method === "GET" && url.pathname === "/assets/report.pdf") {
      return Promise.resolve(
        new Response(new Blob(["hello-s3-pdf"], { type: "application/pdf" }), {
          status: 200,
          headers: {
            etag: '"etag-report-v1"',
            "content-type": "application/pdf",
          },
        }),
      );
    }

    return Promise.resolve(new Response(null, { status: 204 }));
  };

  const awsClient = createClient(
    withEndpoint("https://s3.example.test"),
    withHeaders({ authorization: "AWS4-HMAC-SHA256 aws-cred" }),
    withHTTPHandle(handle),
  );
  const r2Client = createClient(
    withEndpoint("https://r2.example.test"),
    withHeaders({ authorization: "AWS4-HMAC-SHA256 r2-cred" }),
    withHTTPHandle(handle),
  );

  expect(recorded).toEqual([]);

  const [bucketsErr, bucketsOut] = await listBuckets(awsClient);
  expect(bucketsErr).toBeNull();
  expect(bucketsOut?.buckets[0]?.name).toBe("assets");
  expect(bucketsOut?.buckets[0]?.creationDate).toBeInstanceOf(Date);

  const [headBucketErr] = await headBucket(awsClient, { bucket: "assets" });
  expect(headBucketErr).toBeNull();

  const [putErr, , putRes] = await putObject(awsClient, {
    bucket: "assets",
    key: "report.pdf",
    body: new Blob(["hello-s3-pdf"], { type: "application/pdf" }),
    contentType: "application/pdf",
    storageClass: "STANDARD",
  });
  expect(putErr).toBeNull();
  expect(putRes?.headers.get("etag")).toBe('"etag-report-v1"');

  const [listErr, page] = await listObjectsV2(awsClient, {
    bucket: "assets",
    prefix: "reports/",
    maxKeys: 50,
  });
  expect(listErr).toBeNull();
  expect(page?.isTruncated).toBe(false);
  expect(page?.contents[0]?.key).toBe("report.pdf");
  expect(page?.contents[0]?.storageClass).toBe("STANDARD");

  const [headErr, , headRes] = await headObject(awsClient, {
    bucket: "assets",
    key: "report.pdf",
  });
  expect(headErr).toBeNull();
  expect(headRes?.headers.get("content-length")).toBe("12");

  const [getErr, blob, getRes] = await getObject(awsClient, {
    bucket: "assets",
    key: "report.pdf",
    ifNoneMatch: '"old-etag"',
  });
  expect(getErr).toBeNull();
  expect(await blob?.text()).toBe("hello-s3-pdf");
  expect(getRes?.headers.get("etag")).toBe('"etag-report-v1"');

  const [missingErr, absentBlob] = await getObject(r2Client, {
    bucket: "assets",
    key: "report.pdf",
  });
  expect(absentBlob).toBeUndefined();
  expect(missingErr?.code).toBe("HTTP_STATUS");
  if (missingErr?.code === "HTTP_STATUS") {
    expect(missingErr.status).toBe(404);
    expect(missingErr.data.code).toBe("NoSuchKey");
    expect(missingErr.data.requestId).toBe("req-404");
  }

  const [delObjErr] = await deleteObject(awsClient, {
    bucket: "assets",
    key: "report.pdf",
  });
  expect(delObjErr).toBeNull();

  const [delBucketErr] = await deleteBucket(awsClient, { bucket: "assets" });
  expect(delBucketErr).toBeNull();

  expect(recorded[2]).toEqual({
    method: "PUT",
    url: "https://s3.example.test/assets/report.pdf",
    authorization: "AWS4-HMAC-SHA256 aws-cred",
    contentType: "application/pdf",
    storageClass: "STANDARD",
    ifNoneMatch: null,
  });
  expect(recorded[3]?.url).toBe(
    "https://s3.example.test/assets?list-type=2&prefix=reports%2F&max-keys=50",
  );
  expect(recorded[5]?.ifNoneMatch).toBe('"old-etag"');
  expect(recorded[6]?.authorization).toBe("AWS4-HMAC-SHA256 r2-cred");
});
