import { net, protocol } from "electron";

/** The custom scheme used to serve local files to the renderer. */
export const LOCAL_FILE_SCHEME = "local-file";

/**
 * Register `local-file` as a privileged scheme.
 *
 * **Must** be called before `app.whenReady()` resolves — Electron requires
 * scheme registration during the very early startup phase.
 */
export function registerLocalFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: LOCAL_FILE_SCHEME,
      privileges: {
        standard: false,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
      },
    },
  ]);
}

/**
 * Install the protocol handler that maps `local-file:///<path>` to a
 * `file:///<path>` fetch via Electron's `net` module.
 *
 * Call this **after** `app.whenReady()`.
 */
export function registerLocalFileHandler(): void {
  protocol.handle(LOCAL_FILE_SCHEME, (request) => {
    // Strip the scheme prefix to recover the absolute file path.
    // URL format: local-file:///absolute/path or local-file:///C:/path
    const fileUrl = request.url.replace(`${LOCAL_FILE_SCHEME}://`, "file://");
    return net.fetch(fileUrl);
  });
}
