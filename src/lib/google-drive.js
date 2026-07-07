import { config } from '../config.js';
import { db } from '../db.js';

/**
 * Generates Google OAuth authorization URL for Drive file access.
 */
export function getAuthUrl(eventId, redirectUri) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.google.clientId || '',
    redirect_uri: redirectUri,
    scope: 'https://www.googleapis.com/auth/drive.file',
    state: String(eventId),
    access_type: 'offline',
    prompt: 'consent'
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchanges authorization code for access and refresh tokens.
 */
export async function getTokens(code, redirectUri) {
  const params = new URLSearchParams({
    code,
    client_id: config.google.clientId || '',
    client_secret: config.google.clientSecret || '',
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });
  
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'Failed to exchange Google OAuth code');
  }
  return data;
}

/**
 * Refreshes an expired access token using the refresh token.
 */
export async function refreshAccessToken(refreshToken) {
  const params = new URLSearchParams({
    client_id: config.google.clientId || '',
    client_secret: config.google.clientSecret || '',
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });
  
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'Failed to refresh Google access token');
  }
  return data;
}

/**
 * Uploads a file buffer to Google Drive.
 */
export async function uploadFile({ name, mimeType, buffer, accessToken }) {
  const metadata = {
    name: name,
    mimeType: mimeType
  };

  const boundary = 'xxxxxxxxxx';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const mediaPart = buffer.toString('base64');

  const multipartRequestBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: ' + mimeType + '\r\n' +
    'Content-Transfer-Encoding: base64\r\n\r\n' +
    mediaPart +
    closeDelimiter;

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(Buffer.byteLength(multipartRequestBody))
    },
    body: multipartRequestBody
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || 'Failed to upload file to Google Drive');
  }
  return data.id; // Returns Google Drive file ID
}

/**
 * Fetches the binary file stream from Google Drive.
 */
export async function downloadFile({ fileId, accessToken }) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  if (!res.ok) {
    throw new Error(`Failed to stream file from Google Drive: ${res.statusText}`);
  }
  return res;
}

/**
 * Ensures access token is valid (refreshes if close to expiry) and returns it.
 */
export async function getValidAccessToken(eventId) {
  const event = await db.prepare('SELECT storage_config FROM events WHERE id = ?').get(eventId);
  if (!event || !event.storage_config) {
    throw new Error('Google Drive is not connected for this event.');
  }

  const configData = JSON.parse(event.storage_config);
  if (configData.mock) {
    return 'mock_access_token';
  }

  const now = Date.now();
  if (configData.access_token && configData.expires_at && configData.expires_at > now + 60000) {
    return configData.access_token;
  }

  if (!configData.refresh_token) {
    throw new Error('Google Drive integration requires reconnection (missing refresh token).');
  }

  console.log(`[GOOGLE OAUTH] Automatically refreshing access token for event ID: ${eventId}`);
  const refreshResult = await refreshAccessToken(configData.refresh_token);
  
  const newAccessToken = refreshResult.access_token;
  const newExpiresAt = Date.now() + (refreshResult.expires_in * 1000);

  configData.access_token = newAccessToken;
  configData.expires_at = newExpiresAt;

  await db.prepare("UPDATE events SET storage_config = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(configData), eventId);

  return newAccessToken;
}

/**
 * Deletes a file from Google Drive.
 */
export async function deleteFile({ fileId, accessToken }) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Failed to delete file from Google Drive: ${res.statusText}`);
  }
  return true;
}

