const DEVICE_ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

export function setCors(res, methods = 'GET, POST, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export function isValidDeviceId(value) {
  return typeof value === 'string' && DEVICE_ID_RE.test(value.trim());
}

export function bodySize(value) {
  return Buffer.byteLength(JSON.stringify(value || {}), 'utf8');
}

export function internalError(res, label, error) {
  console.error(label, error);
  return res.status(500).json({ error: 'internal error' });
}
