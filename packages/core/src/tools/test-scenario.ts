import { takeScreenshot } from './screenshot.js';

interface TestScenarioOptions {
  setupCode?: string;       // Luau code to run before test
  testCode: string;         // Luau code to run as the test
  mode?: 'play' | 'run';   // Playtest mode, default 'play'
  captureDelay?: number;    // ms to wait before screenshot, default 2000
  timeout?: number;         // max test time in ms, default 30000
  screenshotCompression?: 'none' | 'low' | 'medium' | 'high';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runTestScenario(
  tools: {
    startPlaytest: (mode: string) => Promise<any>;
    executeLuau: (code: string) => Promise<any>;
    getPlaytestOutput: () => Promise<any>;
    stopPlaytest: () => Promise<any>;
  },
  options: TestScenarioOptions
): Promise<any> {
  const mode = options.mode || 'play';
  const captureDelay = options.captureDelay || 2000;
  const timeout = options.timeout || 30000;
  const screenshotCompression = options.screenshotCompression || 'medium';

  const results: Array<{ step: string; success: boolean; data?: any; error?: string }> = [];
  let screenshotContent: any = null;

  try {
    // Step 1: Start playtest
    try {
      const startResult = await tools.startPlaytest(mode);
      results.push({ step: 'start_playtest', success: true, data: startResult });
    } catch (err: any) {
      results.push({ step: 'start_playtest', success: false, error: err.message });
      return buildResult(results, null);
    }

    // Brief wait for playtest to initialize
    await sleep(1500);

    // Step 2: Run setup code (optional)
    if (options.setupCode) {
      try {
        const setupResult = await tools.executeLuau(options.setupCode);
        results.push({ step: 'setup', success: true, data: setupResult });
      } catch (err: any) {
        results.push({ step: 'setup', success: false, error: err.message });
      }
      await sleep(500);
    }

    // Step 3: Run test code
    try {
      const testResult = await tools.executeLuau(options.testCode);
      results.push({ step: 'test', success: true, data: testResult });
    } catch (err: any) {
      results.push({ step: 'test', success: false, error: err.message });
    }

    // Step 4: Wait and capture screenshot
    await sleep(captureDelay);

    try {
      screenshotContent = await takeScreenshot({ compression: screenshotCompression });
      results.push({ step: 'screenshot', success: true });
    } catch (err: any) {
      results.push({ step: 'screenshot', success: false, error: err.message });
    }

    // Step 5: Collect output
    try {
      const output = await tools.getPlaytestOutput();
      results.push({ step: 'collect_output', success: true, data: output });
    } catch (err: any) {
      results.push({ step: 'collect_output', success: false, error: err.message });
    }

    // Step 6: Stop playtest
    try {
      const stopResult = await tools.stopPlaytest();
      results.push({ step: 'stop_playtest', success: true, data: stopResult });
    } catch (err: any) {
      results.push({ step: 'stop_playtest', success: false, error: err.message });
    }

    return buildResult(results, screenshotContent);
  } catch (err: any) {
    // Ensure playtest stops on unexpected error
    try { await tools.stopPlaytest(); } catch { /* best-effort */ }
    results.push({ step: 'unexpected_error', success: false, error: err.message });
    return buildResult(results, screenshotContent);
  }
}

function buildResult(
  results: Array<{ step: string; success: boolean; data?: any; error?: string }>,
  screenshotContent: any
): any {
  const content: Array<{ type: string; data?: string; mimeType?: string; text?: string }> = [];

  // Add text summary
  content.push({
    type: 'text',
    text: JSON.stringify({
      summary: {
        steps: results.map(r => `${r.step}: ${r.success ? 'OK' : 'FAILED'}`),
        allPassed: results.every(r => r.success),
      },
      details: results,
    })
  });

  // Add screenshot if captured
  if (screenshotContent?.content?.[0]?.type === 'image') {
    content.push(screenshotContent.content[0]);
  }

  return { content };
}
