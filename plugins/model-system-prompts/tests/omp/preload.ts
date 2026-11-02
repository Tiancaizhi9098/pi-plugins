import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// OMP caches its agent directory at import time. Isolate before loading the SDK.
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "omp-model-prompts-"));
