"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  addSellerReply,
  startIntakeConversation,
} from "@backend/intake/service";

/**
 * The seller chat surface's server actions (spec §12).
 *
 * Public by design: a seller has no account, exactly as the `/sell` form takes
 * none. The conversation id returned by `startIntakeConversation` is a
 * capability token from a CSPRNG (a v4 UUID), so the URL a seller is sent to is
 * the only way back to their conversation — it is never derived from anything
 * guessable about them or the property (decision #13).
 *
 * Neither action trusts the client for anything but the message text and, on a
 * reply, the conversation id. What happens next — whether the assistant may
 * answer at all — is decided server-side by the deterministic gate, never here.
 */

const MAX_MESSAGE = 4_000;

function cleanMessage(raw: FormDataEntryValue | null): string {
  const text = String(raw ?? "").trim();
  return text.slice(0, MAX_MESSAGE);
}

export async function startChat(formData: FormData): Promise<void> {
  const text = cleanMessage(formData.get("message"));
  if (text === "") redirect("/sell/chat?empty=1");
  const conversation = await startIntakeConversation(text);
  redirect(`/sell/chat/${conversation.id}`);
}

export async function replyChat(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const text = cleanMessage(formData.get("message"));
  if (id === "") redirect("/sell/chat");
  if (text === "") redirect(`/sell/chat/${id}?empty=1`);
  const updated = await addSellerReply(id, text);
  if (updated === undefined) redirect("/sell/chat");
  revalidatePath(`/sell/chat/${id}`);
  redirect(`/sell/chat/${id}`);
}
