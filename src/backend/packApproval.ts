import { createHash } from "node:crypto";
import type { DealRecord } from "@backend/store/schema";
import {
  approvalStatus,
  packPayload,
  stableStringify,
  type ApprovalStatus,
  type PackApprovalInput,
} from "@shared/domain/packApproval";

/**
 * The content hash and approval status for a deal's pack (spec §8/§10).
 *
 * The pure module (`@shared/domain/packApproval`) canonicalises and compares;
 * here is where a real digest is taken, because node:crypto is server-only.
 * The hash is over the stored inputs plus the material and seller-check facts —
 * everything the memorandum is built from — so an operator editing the price,
 * the costs or a disclosed fact changes the hash and voids any approval.
 */

export function packContentHash(input: PackApprovalInput): string {
  return createHash("sha256").update(stableStringify(packPayload(input))).digest("hex");
}

/** The content hash of a deal record's pack. */
export function recordPackHash(record: DealRecord): string {
  return packContentHash({
    inputs: record.inputs,
    material: record.material,
    sellerChecks: record.sellerChecks,
  });
}

/** Whether this record's pack approval (if any) still matches its content. */
export function recordApprovalStatus(record: DealRecord): ApprovalStatus {
  return approvalStatus(recordPackHash(record), record.packApproval);
}
