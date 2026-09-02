"use server";

import { revalidatePath } from "next/cache";
import { requirePermission, viewerAccount } from "@/app/operator/guard";
import { getDeal, saveDeal } from "@backend/store/repository";
import { audit } from "@backend/audit";
import {
  MATERIAL_ITEMS,
  type Knowledge,
  type MaterialRecord,
} from "@shared/domain/materialInformation";

/**
 * Recording what is known about a property.
 *
 * One item at a time, and the state is chosen explicitly rather than inferred
 * from whether a box is empty. That is the whole design: an empty field means
 * nobody has answered, "not known" means somebody asked and could not find
 * out, and the two are different facts about our diligence. A form that
 * collapsed them would recreate exactly the omission this is here to prevent.
 */

export interface MaterialResult {
  readonly ok: boolean;
  readonly message: string;
}

function isItemKey(value: string): boolean {
  return MATERIAL_ITEMS.some((i) => i.key === value);
}

export async function recordMaterialAction(
  _previous: MaterialResult | undefined,
  formData: FormData,
): Promise<MaterialResult> {
  const dealId = String(formData.get("dealId") ?? "").trim();
  const key = String(formData.get("key") ?? "").trim();
  const state = String(formData.get("state") ?? "").trim();
  const text = String(formData.get("text") ?? "").trim();

  const viewer = await requirePermission("view-seller-data", `/deals/${dealId}/material`);
  const account = viewerAccount(viewer);
  if (!isItemKey(key)) return { ok: false, message: "No such item." };

  let knowledge: Knowledge;
  switch (state) {
    case "stated":
      if (text === "") return { ok: false, message: "State what is known." };
      knowledge = { state: "stated", value: text };
      break;
    case "not-applicable":
      if (text === "") return { ok: false, message: "Say why it does not apply." };
      knowledge = { state: "not-applicable", why: text };
      break;
    case "not-known":
      if (text === "") {
        return {
          ok: false,
          message:
            "Name who was asked. “Not known” is only an honest answer when somebody actually asked.",
        };
      }
      knowledge = { state: "not-known", whoWasAsked: text };
      break;
    default:
      return { ok: false, message: "Choose what is known about it." };
  }

  const record = await getDeal(dealId);
  if (record === undefined) return { ok: false, message: "No such deal." };

  const material: MaterialRecord = { ...(record.material ?? {}), [key]: knowledge };
  await saveDeal({ ...record, material });
  await audit("material-information-recorded", {
    ...(account !== undefined ? { account } : {}),
    subject: dealId,
    detail: `${key} · ${state}`,
  });

  revalidatePath(`/deals/${dealId}/material`);
  revalidatePath(`/opportunities/${dealId}`);
  return { ok: true, message: "Recorded." };
}
