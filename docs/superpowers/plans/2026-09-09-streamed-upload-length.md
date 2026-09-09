# Streamed upload length

The fresh producer runtime rehearsal reproduced HTTP 422 with the real package.
A disposable Miniflare R2 diagnostic confirmed identical seven-byte streamed
bodies fail without Content-Length (known-length stream required) and succeed
with Content-Length: 7. The existing route maps this storage exception to its
checksum failure response; do not weaken checksum checks to bypass the failure.

Add a failing uploader regression asserting the outgoing Content-Length matches
the already size/hash-verified artifact. Then set this header on the existing
streaming request. Preserve sequential upload, hash validation, signatures and
all limits; do not buffer the file or modify the Worker route. Run package tests,
independent review, full platform validation and the actual local recovery
rehearsal. Release/adoption requires a new immutable npm version and the existing
authentication/verification gates; do not silently replace released 0.1.2.
