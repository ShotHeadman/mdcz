export const DEFAULT_SERVER_PORT = 3838;

export const parsePort = (value: string | undefined): number => {
  if (!value) {
    return DEFAULT_SERVER_PORT;
  }

  const normalizedValue = value.trim();
  if (!/^\d+$/.test(normalizedValue)) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  const port = Number(normalizedValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return port;
};
