"use client";

import { ALL_STRUCTURES, STRUCTURE_LABELS } from "@/domain/strategies";
import type { BuyBox } from "@/domain/matching";
import { toMajor } from "@/lib/money";
import {
  CheckGroup,
  Field,
  MandateForm,
  TextInput,
  Toggle,
} from "@/app/components/mandate";
import { saveBuyBoxAction } from "./actions";

const JURISDICTIONS = [
  { value: "GB-ENG", label: "England" },
  { value: "GB-WLS", label: "Wales" },
  { value: "GB-SCT", label: "Scotland" },
  { value: "GB-NIR", label: "Northern Ireland" },
];

const PROPERTY_TYPES = [
  { value: "house", label: "House" },
  { value: "flat", label: "Flat" },
  { value: "bungalow", label: "Bungalow" },
  { value: "hmo", label: "HMO" },
  { value: "commercial", label: "Commercial" },
  { value: "mixed-use", label: "Mixed use" },
  { value: "land", label: "Land" },
];

const STRUCTURES = ALL_STRUCTURES.map((s) => ({ value: s, label: STRUCTURE_LABELS[s] }));

/**
 * Buy Box form.
 *
 * Editing an existing mandate re-renders this with `box` set; the hidden id is
 * what makes the save an update rather than a duplicate.
 */
export function BuyBoxForm({ box }: { box?: BuyBox }) {
  const editing = box !== undefined;

  return (
    <MandateForm
      action={saveBuyBoxAction}
      title={editing ? `Edit ${box.investorName}` : "Add a Buy Box"}
      summary={
        editing
          ? "Changes take effect immediately, including in the buyer count sellers are shown."
          : "What this investor will buy. Sellers are told how many mandates their property meets, so these criteria are a statement made to the public."
      }
      openByDefault={editing}
    >
      {editing && <input type="hidden" name="id" value={box.id} />}

      <Field label="Investor name">
        <TextInput name="investorName" required defaultValue={box?.investorName} maxLength={120} />
      </Field>

      <Field label="Jurisdictions" hint="Where this investor will transact.">
        <CheckGroup
          name="jurisdictions"
          options={JURISDICTIONS}
          defaultValues={box?.jurisdictions ?? ["GB-ENG"]}
        />
      </Field>

      <Field label="Localities" hint="Comma separated. Leave empty for anywhere in those jurisdictions.">
        <TextInput
          name="localities"
          defaultValue={box?.localities.join(", ")}
          placeholder="Erdington, Handsworth, Small Heath"
        />
      </Field>

      <Field label="Property types">
        <CheckGroup
          name="propertyTypes"
          options={PROPERTY_TYPES}
          defaultValues={box?.propertyTypes ?? ["house"]}
          columns={3}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Minimum price">
          <TextInput
            name="minPrice"
            required
            inputMode="numeric"
            defaultValue={box === undefined ? "" : toMajor(box.minPrice)}
            placeholder="£120,000"
          />
        </Field>
        <Field label="Maximum price">
          <TextInput
            name="maxPrice"
            required
            inputMode="numeric"
            defaultValue={box === undefined ? "" : toMajor(box.maxPrice)}
            placeholder="£300,000"
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Minimum bedrooms">
          <TextInput
            name="minBedrooms"
            type="number"
            min={0}
            max={20}
            required
            defaultValue={box?.minBedrooms ?? 2}
          />
        </Field>
        <Field label="Minimum margin %" hint="On GDV, after tax.">
          <TextInput
            name="minMargin"
            type="number"
            step="0.5"
            min={0}
            max={100}
            required
            defaultValue={box === undefined ? 15 : box.minMarginBps / 100}
          />
        </Field>
        <Field label="Minimum yield %">
          <TextInput
            name="minYield"
            type="number"
            step="0.5"
            min={0}
            max={100}
            required
            defaultValue={box === undefined ? 6 : box.minYieldBps / 100}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Maximum refurbishment">
          <TextInput
            name="maxRefurbishment"
            required
            inputMode="numeric"
            defaultValue={box === undefined ? "" : toMajor(box.maxRefurbishment)}
            placeholder="£60,000"
          />
        </Field>
        <Field label="Maximum completion days">
          <TextInput
            name="maxCompletionDays"
            type="number"
            min={1}
            max={365}
            required
            defaultValue={box?.maxCompletionDays ?? 60}
          />
        </Field>
        <Field label="Minimum Deal Score" hint="Deals below this are never shown.">
          <TextInput
            name="minDealScore"
            type="number"
            min={0}
            max={100}
            required
            defaultValue={box?.minDealScore ?? 55}
          />
        </Field>
      </div>

      <Field label="Acceptable structures">
        <CheckGroup
          name="acceptableStructures"
          options={STRUCTURES}
          defaultValues={box?.acceptableStructures ?? ["cash-purchase"]}
        />
      </Field>

      <div className="flex flex-wrap gap-6 pt-1">
        <Toggle
          name="acceptsRefurbishment"
          label="Will take refurbishment projects"
          defaultChecked={box?.acceptsRefurbishment ?? true}
        />
        <Toggle
          name="active"
          label="Active — counts towards what sellers are told"
          defaultChecked={box?.active ?? true}
        />
      </div>
    </MandateForm>
  );
}
