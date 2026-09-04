#!/usr/bin/env node
import { resolve } from "node:path";
import { ThreadFlowRepository } from "@threadflow-os/database";
import { AesGcmVault } from "@threadflow-os/shared";

const oldKey = process.env.SCHEDULER_OLD_MASTER_KEY;
const newKey = process.env.SCHEDULER_NEW_MASTER_KEY;
if (!oldKey || !newKey) {
  throw new Error(
    "SCHEDULER_OLD_MASTER_KEY and SCHEDULER_NEW_MASTER_KEY are required",
  );
}
const repository = new ThreadFlowRepository(
  resolve(process.env.SCHEDULER_DB_PATH ?? "data/threadflow.sqlite"),
);
try {
  const oldVault = new AesGcmVault(oldKey);
  const newVault = new AesGcmVault(newKey);
  const rotated = repository.rotateThreadsTokensInternal(
    (ciphertext, associatedData) =>
      newVault.encrypt(
        oldVault.decrypt(ciphertext, associatedData),
        associatedData,
      ),
  );
  process.stdout.write(JSON.stringify({ rotated }) + "\n");
} finally {
  repository.close();
}
