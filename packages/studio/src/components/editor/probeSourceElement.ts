import { buildProjectApiPath } from "../../utils/projectRouting";

type ProbeTarget = { id?: string; hfId?: string; selector?: string; selectorIndex?: number };

interface PendingProbe {
  target: ProbeTarget;
  resolve: (exists: boolean) => void;
}

/** Probes asked for in the same tick, one batch per project file. */
const pending = new Map<
  string,
  { projectId: string; sourceFile: string; probes: PendingProbe[] }
>();

async function sendBatch(projectId: string, sourceFile: string, probes: PendingProbe[]) {
  // Any failure reads as "exists": a probe that cannot answer must not strip capabilities.
  let exists: boolean[] = [];
  try {
    const response = await fetch(
      buildProjectApiPath(
        projectId,
        `/file-mutations/probe-elements/${encodeURIComponent(sourceFile)}`,
      ),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: probes.map((probe) => probe.target) }),
      },
    );
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data?.exists)) exists = data.exists;
    }
  } catch {
    // Falls through to the all-exist answer below.
  }
  probes.forEach((probe, index) => probe.resolve(exists[index] !== false));
}

/**
 * Whether the element still exists in its source file. A selection of N elements asks N times
 * in one tick; the asks for one file leave as a single request.
 */
export function probeSourceElement(
  projectId: string,
  sourceFile: string,
  target: ProbeTarget,
): Promise<boolean> {
  return new Promise((resolve) => {
    const key = `${projectId}\0${sourceFile}`;
    let batch = pending.get(key);
    if (!batch) {
      batch = { projectId, sourceFile, probes: [] };
      pending.set(key, batch);
      const flushing = batch;
      setTimeout(() => {
        pending.delete(key);
        void sendBatch(flushing.projectId, flushing.sourceFile, flushing.probes);
      }, 0);
    }
    batch.probes.push({ target, resolve });
  });
}
