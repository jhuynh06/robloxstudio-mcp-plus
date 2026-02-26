import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

interface ScreenshotOptions {
  compression?: 'none' | 'low' | 'medium' | 'high';
}

const COMPRESSION_SETTINGS: Record<string, { maxWidth: number; quality: number }> = {
  none: { maxWidth: 0, quality: 100 },
  low: { maxWidth: 1920, quality: 85 },
  medium: { maxWidth: 1280, quality: 70 },
  high: { maxWidth: 800, quality: 50 },
};

function findScriptPath(): string {
  // Walk up from this module to find the repo root with scripts/
  let dir = path.dirname(decodeURIComponent(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, '$1'));
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'scripts', 'screenshot.ps1');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('Could not find scripts/screenshot.ps1 — ensure it exists in the repo root');
}

export async function takeScreenshot(options: ScreenshotOptions = {}): Promise<any> {
  const compression = options.compression || 'medium';
  const settings = COMPRESSION_SETTINGS[compression];

  if (!settings) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ error: `Invalid compression level: ${compression}. Use: none, low, medium, high` })
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

  // Convert WSL path to Windows path for PowerShell
  const winScriptPath = scriptPath.replace(/^\/home\//, '/mnt/c/Users/').includes('/mnt/')
    ? scriptPath
    : scriptPath; // If already a Windows-accessible path

  let pngPath: string;
  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      ['-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { timeout: 15000 }
    );

    pngPath = stdout.trim();

    if (!pngPath || !fs.existsSync(pngPath)) {
      // PowerShell might return a Windows path — try converting
      const wslPath = pngPath.replace(/^([A-Z]):\\/, (_, drive: string) => `/mnt/${drive.toLowerCase()}/`).replace(/\\/g, '/');
      if (fs.existsSync(wslPath)) {
        pngPath = wslPath;
      } else {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              error: 'Screenshot captured but file not accessible',
              rawPath: stdout.trim(),
              stderr: stderr?.trim() || undefined
            })
          }]
        };
      }
    }
  } catch (err: any) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Failed to capture screenshot',
          details: err.message || String(err),
          stderr: err.stderr?.trim() || undefined
        })
      }]
    };
  }

  try {
    let imageBuffer = fs.readFileSync(pngPath);

    // Apply compression
    if (compression === 'none') {
      const base64 = imageBuffer.toString('base64');
      cleanup(pngPath);
      return {
        content: [{
          type: 'image',
          data: base64,
          mimeType: 'image/png',
        }]
      };
    }

    let pipeline = sharp(imageBuffer);

    if (settings.maxWidth > 0) {
      const metadata = await sharp(imageBuffer).metadata();
      if (metadata.width && metadata.width > settings.maxWidth) {
        pipeline = pipeline.resize(settings.maxWidth);
      }
    }

    const jpegBuffer = await pipeline.jpeg({ quality: settings.quality }).toBuffer();
    const base64 = jpegBuffer.toString('base64');

    cleanup(pngPath);

    return {
      content: [{
        type: 'image',
        data: base64,
        mimeType: 'image/jpeg',
      }]
    };
  } catch (err: any) {
    cleanup(pngPath);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'Failed to process screenshot',
          details: err.message || String(err)
        })
      }]
    };
  }
}

function cleanup(filePath: string) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // Best-effort cleanup
  }
}
