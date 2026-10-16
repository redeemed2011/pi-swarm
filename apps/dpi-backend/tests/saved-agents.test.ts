import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSavedAgents, startSavedAgents } from "../src/saved-agents.js";
import { tempStore } from "./helpers.js";

test("saved agents start once per key and skip profiles that do not autostart", async () => {
  const t = await tempStore();
  const store = await t.open();
  const file = join(t.root, "agents.json");
  try {
    assert.deepEqual(loadSavedAgents(join(t.root, "missing.json")), []);
    await writeFile(
      file,
      JSON.stringify([
        { key: "brief", name: "Brief", cwd: t.work, model: "grok-4.7", autostart: true, prompt: "hi" },
        { key: "idle", name: "Idle", cwd: t.work, autostart: false },
      ]),
    );
    const first = await startSavedAgents(store, file);
    const again = await startSavedAgents(store, file);
    assert.equal(first.length, 1);
    assert.equal(again.length, 1);
    assert.equal(first[0].session.id, again[0].session.id);
    assert.equal(first[0].submissionId, again[0].submissionId);
    assert.equal(store.list().length, 1);
    await writeFile(file, "{");
    assert.throws(() => loadSavedAgents(file), /not valid JSON/);
  } finally {
    await store.close();
    await t.cleanup();
  }
});
