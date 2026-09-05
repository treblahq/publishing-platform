# @trebla/publishing-client

Fail-closed client for staging durable publishing handoffs on disk and
uploading their artifacts to the Trebla publishing platform.

```sh
npm install @trebla/publishing-client@0.1.0
```

Local staging is network-free. Uploads require an explicit platform endpoint
and producer credentials supplied by the consuming application at runtime.
No credentials are bundled in this package.

Released from the public
[`treblahq/publishing-platform`](https://github.com/treblahq/publishing-platform)
repository under the MIT license.
