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
 * Improved NSFW detection that avoids racial bias.
 * 
 * The previous implementation used Kovac's RGB skin-tone classification which 
 * disproportionately flags photos of brown/dark-skinned people as NSFW.
 * This is a critical fairness issue for an Indian wedding platform.
 * 
 * This improved version uses multiple signals:
 * 1. Filename keyword matching (high confidence)
 * 2. Conservative low-resolution image analysis that looks at overall 
 *    color variance and saturation rather than skin-tone detection
 * 
 * NOTE: For production-grade NSFW detection, integrate a real ML model 
 * (e.g., AWS Rekognition Moderation, Google Cloud Vision SafeSearch, 
 * or a self-hosted NSFW classifier). The pixel heuristic is intentionally 
 * conservative to avoid false positives.
 * 
 * @param {string} filePath - Absolute path to local image file
 * @param {string} originalName - Original filename for keyword checks
 * @returns {Promise<{isNsfw: boolean, confidence: number, reason: string}>}
 */
export async function detectNudity(filePath, originalName = '') {
  try {
    // Signal 1: Filename keywords are a strong indicator
    if (hasAdultKeywords(originalName)) {
      return {
        isNsfw: true,
        confidence: 95,
        reason: `Explicit keyword matched in filename: "${originalName}"`
      };
    }

    // Signal 2: Conservative image analysis
    // Instead of skin-tone detection (which is racially biased), we check for:
    // - Very low color variance (uniformly colored images are suspicious)
    // - Very high saturation uniformity in flesh-tone ranges
    // But we set a VERY high threshold to minimize false positives.
    // Real NSFW detection should use a trained ML model.
    
    const { data, info } = await sharp(filePath)
      .resize(32, 32, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const totalPixels = info.width * info.height;
    let highSaturationCount = 0;
    let veryLowVariance = true;
    let prevR = -1, prevG = -1, prevB = -1;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Check color variance — if nearly every pixel is the same, it's suspicious
      if (prevR >= 0) {
        const diff = Math.abs(r - prevR) + Math.abs(g - prevG) + Math.abs(b - prevB);
        if (diff > 30) veryLowVariance = false;
      }
      prevR = r; prevG = g; prevB = b;

      // Convert to HSL to check saturation (color-space agnostic, not skin-biased)
      const max = Math.max(r, g, b) / 255;
      const min = Math.min(r, g, b) / 255;
      const l = (max + min) / 2;
      const s = max === min ? 0 : (l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min));
      
      // Count pixels with specific characteristics
      // Low saturation + medium lightness = potential flesh tones across ALL skin colors
      if (s < 0.35 && l > 0.2 && l < 0.85) {
        highSaturationCount++;
      }
    }

    const uniformFleshRatio = highSaturationCount / totalPixels;

    // Only flag if the image is both extremely uniform AND has very high
    // concentration of low-saturation mid-lightness pixels (>85%).
    // This is intentionally conservative to avoid false positives.
    // A wedding photo with people, decorations, and varied backgrounds 
    // will naturally have diverse colors and won't trigger this.
    const isNsfw = veryLowVariance && uniformFleshRatio > 0.85;
    const confidence = isNsfw ? Math.round(uniformFleshRatio * 100) : 0;

    return {
      isNsfw,
      confidence,
      reason: isNsfw
        ? `Suspicious: highly uniform low-saturation image (${confidence}% uniform). Manual review recommended.`
        : `Safe: Image has diverse color patterns (${Math.round(uniformFleshRatio * 100)}% uniform — below threshold).`
    };
  } catch (err) {
    console.error('[NSFW DETECTOR ERROR] Defaulting to safe:', err);
    return { isNsfw: false, confidence: 0, reason: 'Moderation analysis failed. Defaulted to safe.' };
  }
}
