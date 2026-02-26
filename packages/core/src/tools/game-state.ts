import { StudioHttpClient } from './studio-client.js';

function textResult(data: any) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }]
  };
}

export async function getFullState(client: StudioHttpClient): Promise<any> {
  try {
    const response = await client.request('/api/get-full-state', {});
    return textResult(response);
  } catch (err: any) {
    return textResult({
      error: 'Failed to get full state',
      details: err.message || String(err)
    });
  }
}

export async function getDiagnostics(client: StudioHttpClient): Promise<any> {
  try {
    const response = await client.request('/api/diagnostics', {});
    return textResult(response);
  } catch (err: any) {
    return textResult({
      error: 'Failed to get diagnostics',
      details: err.message || String(err)
    });
  }
}

export async function getLogs(client: StudioHttpClient, maxEntries?: number): Promise<any> {
  try {
    const response = await client.request('/api/get-logs', {
      maxEntries: maxEntries || 50
    });
    return textResult(response);
  } catch (err: any) {
    return textResult({
      error: 'Failed to get logs',
      details: err.message || String(err)
    });
  }
}
