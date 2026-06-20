import sharp from 'sharp';

/**
 * Checks if a filename contains adult/nude/NSFW keywords.
 * 
 * @param {string} filename 
 * @returns {boolean}
 */
export function hasAdultKeywords(filename) {
  if (!filename) return false;
  const lower = filename.toLowerCase();
  const keywords = ['nude', 'naked', 'sex', 'porn', 'nsfw', 'xxx', 'erotic', 'boob', 'dick', 'pussy', 'vagina', 'penis', 'cock', 'asshole'];
  return keywords.some(k => lower.includes(k));
}

/**
 * Classifies an image file to check if it contains potential nudity/NSFW content.
 * Uses Kovac's RGB skin color classification rules on a resized low-resolution image grid.
 * 
 * @param {string} filePath - Absolute path to local image file
 * @param {string} originalName - Original filename for keyword checks
 * @returns {Promise<{isNsfw: boolean, confidence: number, reason: string}>}
 */
export async function detectNudity(filePath, originalName = '') {
  try {
    // First, check filename keywords as an instant signal
    if (hasAdultKeywords(originalName)) {
      return {
        isNsfw: true,
        confidence: 100,
        reason: `Explicit keyword matched in filename: "${originalName}"`
      };
    }

    // Resize image to 40x40 to analyze pixels quickly and reduce noise
    const { data, info } = await sharp(filePath)
      .resize(40, 40, { fit: 'inside' })
      .ensureAlpha() // Ensure 4 channels: R, G, B, A
      .raw()
      .toBuffer({ resolveWithObject: true });

    let skinPixels = 0;
    const totalPixels = info.width * info.height;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Skin color classification heuristic (Kovac et al. rules for RGB)
      // Standard rule: R > 95, G > 40, B > 20, max(R,G,B) - min(R,G,B) > 15, |R-G| > 15, R > G, R > B
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const isSkin = 
        r > 95 && 
        g > 40 && 
        b > 20 && 
        (max - min) > 15 && 
        Math.abs(r - g) > 15 && 
        r > g && 
        r > b;

      if (isSkin) {
        skinPixels++;
      }
    }

    const skinRatio = skinPixels / totalPixels;
    const confidence = Math.round(skinRatio * 100);

    // If more than 40% of the image is skin tone, flag it as potential nudity/NSFW
    const isNsfw = skinRatio > 0.40;

    return {
      isNsfw,
      confidence,
      reason: isNsfw 
        ? `High concentration of skin-tone pixels detected (${confidence}%).` 
        : `Safe: Skin-tone ratio is low (${confidence}%).`
    };
  } catch (err) {
    console.error('[NSFW DETECTOR ERROR] Defaulting to safe:', err);
    return { isNsfw: false, confidence: 0, reason: 'Moderation analysis failed. Defaulted to safe.' };
  }
}
