export async function api(path, { token, method = 'GET', body, formData } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  // A request that never answers (weak mobile signal) must not leave buttons
  // such as BINGO disabled for the rest of the round. Uploads may be slow.
  const controller = formData ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), 20000) : null;
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: formData || (body ? JSON.stringify(body) : undefined),
      signal: controller?.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error('ግንኙነቱ ዘገየ። እባክዎ እንደገና ይሞክሩ።');
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }

  let data = {};
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!res.ok) {
    const error = new Error(data.error || `ጥያቄው አልተሳካም (${res.status})`);
    error.status = res.status;
    throw error;
  }
  return data;
}
