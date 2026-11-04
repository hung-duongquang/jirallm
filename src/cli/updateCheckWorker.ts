// Background half of the daily update check (see updateCheck.ts): fetches the release branch's
// version and stores it for the next CLI run. Runs detached; failures are silent.
import { fetchLatestVersion, writeState } from './updateCheck.js';

try {
  writeState({ lastCheck: Date.now(), latest: await fetchLatestVersion() });
} catch {
  // Offline or GitHub unreachable: try again after the next interval.
}
