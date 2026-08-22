"use client";

import { FUNDER_KIND_LABELS, type FundingBox } from "@shared/domain/matching";
import { toMajor } from "@shared/money";
import {
  CheckGroup,
  Field,
  MandateForm,
  Select,
  TextInput,
  Toggle,
} from "@/app/components/mandate";
import { saveFundingBoxAction } from "./actions";

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

const FUNDER_KINDS = Object.entries(FUNDER_KIND_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export function FundingBoxForm({ box }: { box?: FundingBox }) {
  const editing = box !== undefined;

  return (
    <MandateForm
      action={saveFundingBoxAction}
      title={editing ? `Edit ${box.funderName}` : "Add a Funding Box"}
      summary={
        editing
          ? "Changes take effect immediately for every deal matched from now on."
          : "What this funder will lend or invest against, and on what terms. A wrong figure here produces silence rather than an error, and silence reads as no capital available."
      }
      openByDefault={editing}
    >
      {editing && <input type="hidden" name="id" value={box.id} />}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Funder name">
          <TextInput name="funderName" required defaultValue={box?.funderName} maxLength={120} />
        </Field>
        <Field label="Kind">
          <Select name="kind" options={FUNDER_KINDS} defaultValue={box?.kind} />
        </Field>
      </div>

      <Field label="Jurisdictions">
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
          placeholder="Birmingham, Wolverhampton"
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

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="Capital available">
          <TextInput
            name="capitalAvailable"
            required
            inputMode="numeric"
            defaultValue={box === undefined ? "" : toMajor(box.capitalAvailable)}
            placeholder="£2,000,000"
          />
        </Field>
        <Field label="Minimum ticket">
          <TextInput
            name="minTicket"
            required
            inputMode="numeric"
            defaultValue={box === undefined ? "" : toMajor(box.minTicket)}
            placeholder="£75,000"
          />
        </Field>
        <Field label="Maximum ticket">
          <TextInput
            name="maxTicket"
            required
            inputMode="numeric"
            defaultValue={box === undefined ? "" : toMajor(box.maxTicket)}
            placeholder="£500,000"
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-4">
        <Field label="Maximum LTV %">
          <TextInput
            name="maxLtv"
            type="number"
            step="0.5"
            min={0}
            max={100}
            required
            defaultValue={box === undefined ? 70 : box.maxLtvBps / 100}
          />
        </Field>
        <Field label="Required return %" hint="Annual. Equity uses profit share.">
          <TextInput
            name="requiredReturn"
            type="number"
            step="0.1"
            min={0}
            max={100}
            required
            defaultValue={box === undefined ? 9.6 : box.requiredReturnBps / 100}
          />
        </Field>
        <Field label="Minimum term (months)">
          <TextInput
            name="minTermMonths"
            type="number"
            min={1}
            max={360}
            required
            defaultValue={box?.minTermMonths ?? 3}
          />
        </Field>
        <Field label="Maximum term (months)">
          <TextInput
            name="maxTermMonths"
            type="number"
            min={1}
            max={360}
            required
            defaultValue={box?.maxTermMonths ?? 24}
          />
        </Field>
      </div>

      <Field label="Minimum completed deals" hint="Borrower track record required. Zero accepts first-timers.">
        <TextInput
          name="minBorrowerCompletedDeals"
          type="number"
          min={0}
          max={100}
          required
          defaultValue={box?.minBorrowerCompletedDeals ?? 0}
        />
      </Field>

      <div className="grid gap-3 pt-1 sm:grid-cols-2">
        <Toggle
          name="acceptsRefurbishment"
          label="Funds refurbishment"
          defaultChecked={box?.acceptsRefurbishment ?? true}
        />
        <Toggle
          name="acceptsDevelopment"
          label="Funds development"
          defaultChecked={box?.acceptsDevelopment ?? false}
        />
        <Toggle
          name="requiresFirstCharge"
          label="Requires a first charge"
          defaultChecked={box?.requiresFirstCharge ?? true}
        />
        <Toggle
          name="personalGuaranteeRequired"
          label="Requires a personal guarantee"
          defaultChecked={box?.personalGuaranteeRequired ?? true}
        />
        <Toggle name="active" label="Active" defaultChecked={box?.active ?? true} />
      </div>
    </MandateForm>
  );
}
