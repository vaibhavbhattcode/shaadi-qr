/**
 * Strips EXIF metadata (GPS tags, camera profiles, date tags) from image buffers.
 * Currently supports JPEG APP1 segment removal.
 * Pure JavaScript, zero-dependency, extremely fast.
 */
export function stripMetadata(buffer, mimeType) {
  if (mimeType !== 'image/jpeg') {
    return buffer; // Return unmodified for non-JPEG files
  }

  try {
    // Valid JPEG must start with SOI marker (FF D8)
    if (buffer.length < 4 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
      return buffer;
    }

    const chunks = [buffer.subarray(0, 2)]; // Include SOI (FF D8)
    let offset = 2;

    while (offset < buffer.length) {
      // Markers start with 0xFF
      if (buffer[offset] !== 0xFF) {
        offset++;
        continue;
      }

      const marker = buffer[offset + 1];
      if (marker === undefined) break;

      // Standalone markers with no length payload
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
        chunks.push(buffer.subarray(offset, offset + 2));
        offset += 2;
        continue;
      }

      // End of Image (EOI)
      if (marker === 0xD9) {
        chunks.push(buffer.subarray(offset, offset + 2));
        break;
      }

      // Start of Scan (SOS) - Image entropy stream begins. Copy all remaining bytes.
      if (marker === 0xDA) {
        chunks.push(buffer.subarray(offset));
        break;
      }

      // Variable length markers
      if (offset + 3 >= buffer.length) {
        chunks.push(buffer.subarray(offset));
        break;
      }

      const length = (buffer[offset + 2] << 8) | buffer[offset + 3];
      const nextOffset = offset + 2 + length;

      // Marker 0xE1 represents the APP1 marker segment, which houses EXIF (GPS tags, etc.)
      if (marker === 0xE1) {
        // EXIF data resides here: we strip this segment by omitting it from output chunks
        // console.log(`[EXIF STRIPPER] Stripped APP1 EXIF segment of size ${length} bytes`);
      } else {
        // Keep other markers (e.g. APP0/JFIF headers, DQT, DHT, SOF)
        if (nextOffset <= buffer.length) {
          chunks.push(buffer.subarray(offset, nextOffset));
        } else {
          chunks.push(buffer.subarray(offset));
        }
      }

      offset = nextOffset;
    }

    return Buffer.concat(chunks);
  } catch (err) {
    console.error('[EXIF STRIPPER ERROR]', err);
    return buffer; // Fallback to original buffer if parsing fails
  }
}
