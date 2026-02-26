import { HttpService, LogService, RunService } from "@rbxts/services";
import State from "../State";

// Circular log buffer
const LOG_BUFFER_SIZE = 200;
let logBuffer: Array<{ message: string; messageType: string; timestamp: number }> = [];
let logConnection: RBXScriptConnection | undefined;

function ensureLogCapture() {
	if (logConnection) return;
	logConnection = LogService.MessageOut.Connect((message, messageType) => {
		logBuffer.push({
			message,
			messageType: messageType.Name,
			timestamp: tick(),
		});
		// Trim circular buffer
		while (logBuffer.size() > LOG_BUFFER_SIZE) {
			logBuffer.remove(0);
		}
	});
}

// Start capturing immediately when loaded
ensureLogCapture();

function getLogs(requestData: Record<string, unknown>) {
	const maxEntries = (requestData.maxEntries as number | undefined) ?? 50;
	const count = math.min(maxEntries, logBuffer.size());
	const startIdx = logBuffer.size() - count;

	const entries: Array<{ message: string; messageType: string; timestamp: number }> = [];
	for (let i = startIdx; i < logBuffer.size(); i++) {
		entries.push(logBuffer[i]);
	}

	return {
		success: true,
		entries,
		totalBuffered: logBuffer.size(),
		maxBufferSize: LOG_BUFFER_SIZE,
	};
}

function getFullState(_requestData: Record<string, unknown>) {
	// Check if playtest is running
	let isPlaying = false;
	const [ok, result] = pcall(() => {
		return RunService.IsRunning();
	});
	if (ok) isPlaying = result;

	// Get HttpService enabled state
	let httpEnabled = false;
	const [hOk, hResult] = pcall(() => {
		return HttpService.HttpEnabled;
	});
	if (hOk) httpEnabled = hResult;

	// Get recent logs (last 10)
	const recentLogs: Array<{ message: string; messageType: string }> = [];
	const startIdx = math.max(0, logBuffer.size() - 10);
	for (let i = startIdx; i < logBuffer.size(); i++) {
		recentLogs.push({
			message: logBuffer[i].message,
			messageType: logBuffer[i].messageType,
		});
	}

	// Get place info
	let placeId = 0;
	let placeName = "";
	pcall(() => {
		placeId = game.PlaceId;
		placeName = game.Name;
	});

	return {
		success: true,
		playing: isPlaying,
		placeId,
		placeName,
		httpEnabled,
		pluginVersion: State.CURRENT_VERSION,
		connection: (() => {
			const conn = State.getActiveConnection();
			return conn
				? {
						serverUrl: conn.serverUrl,
						isActive: conn.isActive,
						consecutiveFailures: conn.consecutiveFailures,
				  }
				: undefined;
		})(),
		recentLogs,
		logBufferSize: logBuffer.size(),
	};
}

function getDiagnostics(_requestData: Record<string, unknown>) {
	const connections = State.getConnections();
	const connDiags: Array<{
		index: number;
		serverUrl: string;
		isActive: boolean;
		consecutiveFailures: number;
		lastHttpOk: boolean;
	}> = [];

	for (let i = 0; i < connections.size(); i++) {
		const c = connections[i];
		connDiags.push({
			index: i,
			serverUrl: c.serverUrl,
			isActive: c.isActive,
			consecutiveFailures: c.consecutiveFailures,
			lastHttpOk: c.lastHttpOk,
		});
	}

	// HttpService config
	let httpEnabled = false;
	const [hOk, hResult] = pcall(() => {
		return HttpService.HttpEnabled;
	});
	if (hOk) httpEnabled = hResult;

	return {
		success: true,
		pluginVersion: State.CURRENT_VERSION,
		basePort: State.BASE_PORT,
		httpEnabled,
		connections: connDiags,
		activeTabIndex: State.getActiveTabIndex(),
		logBufferSize: logBuffer.size(),
		logBufferMax: LOG_BUFFER_SIZE,
		isRunning: RunService.IsRunning(),
		isStudio: RunService.IsStudio(),
	};
}

export = {
	getLogs,
	getFullState,
	getDiagnostics,
};
