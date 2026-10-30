"use client";

import { adminAllocatableRoles, ROLE_LABELS } from "@shared/domain/accounts";
import { Field, MandateForm, Select, TextInput, Toggle } from "@/app/components/mandate";
import { createAccount } from "./actions";

export function NewAccountForm({ canCreateAdmin }: { canCreateAdmin: boolean }) {
  // Reserved roles (estate agent, lender) are never offered — an admin cannot
  // allocate them. Administrator is offered only to someone who may grant it.
  // The server enforces both regardless; hiding them keeps the form from
  // presenting a choice it would then refuse.
  const roleOptions = adminAllocatableRoles()
    .filter((r) => r !== "admin" || canCreateAdmin)
    .map((r) => ({ value: r, label: ROLE_LABELS[r] }));

  return (
    <MandateForm
      action={createAccount}
      title="Create an account"
      summary="A named person the audit trail can name. Investors and capital providers must certify separately before any deal material reaches them."
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name">
          <TextInput name="name" required maxLength={120} autoComplete="off" />
        </Field>
        <Field label="Email">
          <TextInput name="email" type="email" required autoComplete="off" />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Primary role">
          <Select name="role" options={roleOptions} defaultValue="investor" />
        </Field>
        <Field label="Password" hint="At least 12 characters. Length beats symbols.">
          <TextInput name="password" type="password" required autoComplete="new-password" />
        </Field>
      </div>
      <Field
        label="Additional roles"
        hint="One account, up to three roles in total. Estate agent and lender are not allocatable here — they come from the person's own sign-up."
      >
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {roleOptions.map((r) => (
            <label key={r.value} className="flex items-center gap-2 text-sm text-ink-200">
              <input type="checkbox" name="extraRoles" value={r.value} className="h-4 w-4 accent-lode-400" />
              {r.label}
            </label>
          ))}
        </div>
      </Field>
      <Field
        label="Connected party"
        hint="Mark this account as Lode or a party connected to Lode acting as a principal (buyer, flipper or funder). Sellers are shown a disclosure wherever it takes part. Never set at self-service sign-up."
      >
        <Toggle name="connectedParty" label="This account is Lode or a connected party" />
      </Field>
    </MandateForm>
  );
}
