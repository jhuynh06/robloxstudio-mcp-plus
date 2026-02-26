import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

interface SequenceCaptureOptions {
  frames?: number;         // 2-16, default 4
  interval?: number;       // ms between frames, default 1000
  showLabels?: boolean;    // overlay frame numbers, default true
  compression?: 'low' | 'medium' | 'high'; // default medium
}

const GRID_LAYOUTS: Record<number, [number, number]> = {
  2: [2, 1],
  3: [3, 1],
  4: [2, 2],
  5: [3, 2],
  6: [3, 2],
  7: [4, 2],
  8: [4, 2],
  9: [3, 3],
  10: [4, 3],
  11: [4, 3],
  12: [4, 3],
  13: [4, 4],
  14: [4, 4],
  15: [4, 4],
  16: [4, 4],
};

const COMPRESSION_SETTINGS: Record<string, { maxCellWidth: number; quality: number }> = {
  low: { maxCellWidth: 960, quality: 85 },
  medium: { maxCellWidth: 640, quality: 70 },
  high: { maxCellWidth: 480, quality: 50 },
};

function findScriptPath(): string {
  let dir = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1'));
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'scripts', 'screenshot.ps1');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('Could not find scripts/screenshot.ps1');
}

function resolveScreenshotPath(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (fs.existsSync(trimmed)) return trimmed;
  const wslPath = trimmed.replace(/^([A-Z]):\\/, (_, drive: string) => `/mnt/${drive.toLowerCase()}/`).replace(/\\/g, '/');
  if (fs.existsSync(wslPath)) return wslPath;
  return null;
}

async function captureFrame(scriptPath: string): Promise<Buffer | null> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { timeout: 15000 }
    );

    const filePath = resolveScreenshotPath(stdout);
    if (!filePath) return null;

    const buffer = fs.readFileSync(filePath);
    try { fs.unlinkSync(filePath); } catch { /* best-effort */ }
    return buffer;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function captureSequence(options: SequenceCaptureOptions = {}): Promise<any> {
  const frameCount = Math.max(2, Math.min(16, options.frames || 4));
  const interval = Math.max(200, options.interval || 1000);
  const showLabels = options.showLabels !== false;
  const compression = options.compression || 'medium';
  const settings = COMPRESSION_SETTINGS[compression];

  if (!settings) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ error: `Invalid compression: ${compression}. Use: low, medium, high` })
      }]
    };
  }

  let scriptPath: string;
  try {
    scriptPath = findScriptPath();
  } catch (err) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) })
      }]
    };
  }

  // Capture frames
  const frames: Buffer[] = [];
  for (let i = 0; i < frameCount; i++) {
    if (i > 0) await sleep(interval);
    const frame = await captureFrame(scriptPath);
    if (frame) {
      frames.push(frame);
    }
  }

  if (frames.length === 0) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ error: 'No frames captured. Is Roblox Studio running?' })
      }]
    };
  }

  try {
    // Get dimensions of first frame
    const firstMeta = await sharp(frames[0]).metadata();
    const srcWidth = firstMeta.width || 1920;
    const srcHeight = firstMeta.height || 1080;

    // Determine cell size
    const cellWidth = Math.min(srcWidth, settings.maxCellWidth);
    const cellHeight = Math.round(cellWidth * (srcHeight / srcWidth));

    // Grid layout
    const [cols, rows] = GRID_LAYOUTS[frames.length] || [Math.ceil(Math.sqrt(frames.length)), Math.ceil(frames.length / Math.ceil(Math.sqrt(frames.length)))];
    const compositeWidth = cols * cellWidth;
    const compositeHeight = rows * cellHeight;

    // Resize all frames
    const resizedFrames: Buffer[] = [];
    for (const frame of frames) {
      const resized = await sharp(frame)
        .resize(cellWidth, cellHeight, { fit: 'fill' })
        .toBuffer();
      resizedFrames.push(resized);
    }

    // Build composite inputs
    const compositeInputs: sharp.OverlayOptions[] = [];

    for (let i = 0; i < resizedFrames.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);

      compositeInputs.push({
        input: resizedFrames[i],
        left: col * cellWidth,
        top: row * cellHeight,
      });

      // Add frame label
      if (showLabels) {
        const labelSvg = Buffer.from(`
          <svg width="${cellWidth}" height="${cellHeight}">
            <rect x="4" y="4" width="36" height="24" rx="4" fill="rgba(0,0,0,0.7)"/>
            <text x="22" y="22" text-anchor="middle" font-family="Arial" font-size="14" font-weight="bold" fill="white">${i + 1}</text>
          </svg>
        `);
        compositeInputs.push({
          input: labelSvg,
          left: col * cellWidth,
          top: row * cellHeight,
        });
      }
    }

    // Create the composite image
    const composite = await sharp({
      create: {
        width: compositeWidth,
        height: compositeHeight,
        channels: 3,
        background: { r: 30, g: 30, b: 30 },
      }
    })
      .composite(compositeInputs)
      .jpeg({ quality: settings.quality })
      .toBuffer();

    const base64 = composite.toString('base64');

    return {
      content: [{
        type: 'image',
        data: base64,
        mimeType: 'image/jpeg',
      }]
    };
  } catch (err: any) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Failed to stitch sequence',
          details: err.message || String(err),
          framesCaptured: frames.length,
        })
      }]
    };
  }
}
