import si from 'systeminformation';

export interface RealMetrics {
  cpuUsage: number;
  memoryUsage: number;
  gpuUsage: number;
  gpuTemp: number;
  powerDraw: number;
}

let cachedMetrics: RealMetrics | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 1500; // Cache for 1.5s to avoid hammering system calls

export async function getRealSystemMetrics(): Promise<RealMetrics> {
  const now = Date.now();
  if (cachedMetrics && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedMetrics;
  }

  const [cpuLoad, mem, gpu] = await Promise.all([
    si.currentLoad().catch(() => null),
    si.mem().catch(() => null),
    si.graphics().catch(() => null),
  ]);

  const cpuUsage = cpuLoad?.currentLoad ?? 0;
  const memoryUsage = mem ? (mem.used / mem.total) * 100 : 0;

  // GPU metrics — use first controller if available
  let gpuUsage = 0;
  let gpuTemp = 0;
  let powerDraw = 0;

  if (gpu?.controllers && gpu.controllers.length > 0) {
    const ctrl = gpu.controllers[0];
    gpuUsage = ctrl.utilizationGpu ?? 0;
    gpuTemp = ctrl.temperatureGpu ?? 0;
    powerDraw = ctrl.powerDraw ?? 0;
  }

  cachedMetrics = { cpuUsage, memoryUsage, gpuUsage, gpuTemp, powerDraw };
  lastFetchTime = now;
  return cachedMetrics;
}
