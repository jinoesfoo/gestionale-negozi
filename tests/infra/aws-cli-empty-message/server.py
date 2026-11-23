#!/usr/bin/env python3
"""Local fake S3 endpoint for tests/infra/aws-cli-empty-message/run.sh (OPS-T03).

run.sh starts it as: python3 -I server.py <port file> <mode file> <pid of run.sh>. It listens on
127.0.0.1 only, on a port chosen by the system, and writes the port to <port file>. It stops by
itself when run.sh is gone, even if run.sh could not stop it (for example after a SIGKILL). With an IP endpoint the
client uses path-style addresses, so the first path segment is the bucket, and the bucket name
picks the answer:
  ok                  success, with a minimal body for the operations the test reads
  denied-empty        403 AccessDenied with an empty <Message></Message>, as Hetzner answers
  invalidkey-empty    403 InvalidAccessKeyId, empty message
  signature-empty     403 SignatureDoesNotMatch, empty message
  nolifecycle-empty   404 NoSuchLifecycleConfiguration, empty message
  nolock-empty        404 ObjectLockConfigurationNotFoundError, empty message
  policy-text         404 NoSuchBucketPolicy with its text, as Hetzner (the control case)
  nocode-empty        403 with an empty <Code> and an empty <Message>
A request without a bucket (ListBuckets) gets the answer of the bucket named in <mode file>.
Request bodies are read and dropped; nothing is logged, so no request header (and no signature
of the dummy keys) is kept anywhere.
"""
import http.server
import os
import sys
import threading
import time

XML = '<?xml version="1.0" encoding="UTF-8"?>'
ERRORS = {
    "denied-empty": (403, "AccessDenied", ""),
    "invalidkey-empty": (403, "InvalidAccessKeyId", ""),
    "signature-empty": (403, "SignatureDoesNotMatch", ""),
    "nolifecycle-empty": (404, "NoSuchLifecycleConfiguration", ""),
    "nolock-empty": (404, "ObjectLockConfigurationNotFoundError", ""),
    "policy-text": (404, "NoSuchBucketPolicy", "The bucket policy does not exist"),
    "nocode-empty": (403, "", ""),
}
PORT_FILE, MODE_FILE, PARENT = sys.argv[1], sys.argv[2], int(sys.argv[3])


def watch_parent():
    while True:
        try:
            os.kill(PARENT, 0)
        except OSError:
            os._exit(0)
        time.sleep(1)


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"  # keep-alive, and "100 Continue" for put-object

    def log_message(self, *args):
        pass

    def read_body(self):
        if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
            while True:
                size = int(self.rfile.readline().split(b";")[0].strip() or b"0", 16)
                if size == 0:
                    while self.rfile.readline() not in (b"\r\n", b"\n", b""):
                        pass
                    return
                self.rfile.read(size)
                self.rfile.readline()
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)

    def send(self, status, body=b"", content_type="application/xml", headers=()):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        for name, value in headers:
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    def handle_any(self):
        self.read_body()
        path, _, query = self.path.partition("?")
        bucket, _, key = path.lstrip("/").partition("/")
        listing_buckets = not bucket
        if listing_buckets:
            bucket = open(MODE_FILE).read().strip()
        if bucket in ERRORS:
            status, code, message = ERRORS[bucket]
            body = (XML + "<Error><Code>%s</Code><Message>%s</Message><BucketName>%s</BucketName>"
                    "<RequestId>tx1</RequestId><HostId>h1</HostId></Error>" % (code, message, bucket))
            return self.send(status, body.encode())
        if bucket != "ok":
            return self.send(500, b"")
        if listing_buckets:
            body = (XML + "<ListAllMyBucketsResult><Owner><ID>o</ID></Owner><Buckets><Bucket><Name>ok</Name>"
                    "<CreationDate>2026-11-21T00:00:00.000Z</CreationDate></Bucket></Buckets></ListAllMyBucketsResult>")
            return self.send(200, body.encode())
        if self.command == "GET" and not key and "list-type=2" in query:
            body = (XML + "<ListBucketResult><Name>ok</Name><Prefix></Prefix><KeyCount>1</KeyCount>"
                    "<MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated><Contents><Key>k</Key>"
                    "<LastModified>2026-11-21T00:00:00.000Z</LastModified><ETag>\"e\"</ETag><Size>4</Size>"
                    "<StorageClass>STANDARD</StorageClass></Contents></ListBucketResult>")
            return self.send(200, body.encode())
        if self.command == "GET" and key:
            return self.send(200, b"data", "application/octet-stream",
                             (("ETag", '"8d777f385d3dfec8815d20f7496026dc"'),))
        return self.send(200, b"")

    do_GET = do_PUT = do_POST = do_DELETE = do_HEAD = handle_any


threading.Thread(target=watch_parent, daemon=True).start()
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
with open(PORT_FILE, "w") as f:
    f.write(str(server.server_address[1]))
server.serve_forever()
