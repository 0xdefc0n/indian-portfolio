// Runs before each test file. Uploads, deletes and renames now ask for a snapshot rebuild (M10). Delivered by the
// local queue, those messages would start real EngineBatch containers in the background of unrelated tests. Here
// they are recorded instead (test/helpers/snapshot.ts reads them); a test that wants the consumer runs it itself.
// Installed by assignment, not vi.spyOn, so vi.restoreAllMocks() brings this guard back rather than the real queue.
import { type RebuildMessage, rebuildQueue } from '../src/lib/snapshot'

export const recordedRebuilds: { msg: RebuildMessage; delay: number }[] = []
;(globalThis as { pfRecordedRebuilds?: typeof recordedRebuilds }).pfRecordedRebuilds = recordedRebuilds

rebuildQueue.send = async (_env, msg, delaySeconds = 10) => {
  recordedRebuilds.push({ msg, delay: delaySeconds })
}
rebuildQueue.sendBatch = async (_env, msgs) => {
  for (const m of msgs) recordedRebuilds.push({ msg: m.body, delay: m.delaySeconds ?? 0 })
}
