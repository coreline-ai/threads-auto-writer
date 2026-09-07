const extensionOriginPattern = /^chrome-extension:\/\/[a-p]{32}$/;
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

function splitOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function parseWebOrigin(rawOrigin: string): string {
  let url: URL;
  try {
    url = new URL(rawOrigin);
  } catch {
    throw new Error(`Invalid THREADFLOW_WEB_ORIGINS entry: ${rawOrigin}`);
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    !loopbackHosts.has(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.origin !== rawOrigin
  ) {
    throw new Error(
      "THREADFLOW_WEB_ORIGINS must contain exact loopback origins such as http://127.0.0.1:4173",
    );
  }

  return url.origin;
}

export function parseAllowedClientOrigins(
  extensionOrigins: string | undefined,
  webOrigins: string | undefined,
): string[] {
  const extensions = splitOrigins(extensionOrigins);
  if (extensions.some((origin) => !extensionOriginPattern.test(origin))) {
    throw new Error(
      "THREADFLOW_EXTENSION_ORIGINS must contain only Chrome extension origins",
    );
  }

  const web = splitOrigins(webOrigins).map(parseWebOrigin);
  const origins = [...new Set([...extensions, ...web])];
  if (!origins.length) {
    throw new Error(
      "Configure THREADFLOW_WEB_ORIGINS and/or THREADFLOW_EXTENSION_ORIGINS",
    );
  }
  return origins;
}
