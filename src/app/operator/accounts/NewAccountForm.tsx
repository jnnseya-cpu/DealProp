"use client";

import { ALL_ROLES, ROLE_LABELS } from "@/domain/accounts";
import { Field, MandateForm, Select, TextInput } from "@/app/components/mandate";
import { createAccount } from "./actions";

const ROLE_OPTIONS = ALL_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

export function NewAccountForm() {
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
        <Field label="Role">
          <Select name="role" options={ROLE_OPTIONS} defaultValue="investor" />
        </Field>
        <Field label="Password" hint="At least 12 characters. Length beats symbols.">
          <TextInput name="password" type="password" required autoComplete="new-password" />
        </Field>
      </div>
    </MandateForm>
  );
}
