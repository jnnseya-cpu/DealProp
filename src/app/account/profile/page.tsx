import { redirect } from "next/navigation";
import { OperatorNav } from "@/app/operator/OperatorNav";
import { Panel, SiteHeader } from "@/app/components/chrome";
import { currentViewer } from "@/app/operator/guard";
import { getAccountImage } from "@backend/store/repository";
import { ImageUploader } from "./ProfileImageForms";

export const dynamic = "force-dynamic";

export const metadata = { title: "Your profile — Lode" };

/**
 * The account profile — where any signed-in account sets its picture and cover.
 *
 * Available to every account type, because the request was a picture and a
 * cover on all accounts. The shared operator password is not a person, so it
 * has no personal profile; it is told so rather than shown an upload that would
 * have nowhere to belong.
 */
export default async function ProfilePage() {
  const viewer = await currentViewer();
  if (viewer === undefined) redirect("/operator?next=%2Faccount%2Fprofile");

  if (viewer.kind !== "account") {
    return (
      <main className="min-h-screen">
        <SiteHeader trailing={<OperatorNav current="/account/profile" />} />
        <div className="mx-auto max-w-2xl px-6 py-16">
          <span className="eyebrow">Profile</span>
          <h1 className="mt-2 font-display text-[26px] leading-tight text-ink-100">
            No personal profile here
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-ink-300">
            You are signed in with the shared operator password, which is not a person. A profile
            picture belongs to a named account — sign in as one to set yours.
          </p>
        </div>
      </main>
    );
  }

  const account = viewer.account;
  const [avatar, cover] = await Promise.all([
    getAccountImage(account.id, "avatar"),
    getAccountImage(account.id, "cover"),
  ]);
  // Cache-bust so a just-replaced image shows immediately rather than the
  // browser's held copy.
  const src = (kind: "avatar" | "cover", at?: string) =>
    `/api/account-image/${account.id}/${kind}?v=${encodeURIComponent(at ?? "0")}`;
  const initial = (account.name || account.email || "?").trim().charAt(0).toUpperCase();

  return (
    <main className="min-h-screen pb-24">
      <SiteHeader trailing={<OperatorNav current="/account/profile" />} />

      <div className="mx-auto max-w-3xl px-6 py-10">
        <span className="eyebrow">Profile</span>
        <h1 className="mt-2.5 font-display text-[26px] leading-[1.14] text-ink-100 sm:text-[32px]">
          Your profile
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink-300">
          How you appear across Lode. Both images are optional and only staff and you can see them.
        </p>

        {/* The banner, exactly as it renders elsewhere: cover behind, avatar in front. */}
        <div className="mt-8 overflow-hidden rounded-xl border hairline bg-surface-1">
          <div className="relative h-40 w-full bg-surface-2 sm:h-48">
            {cover !== undefined ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src("cover", cover.createdAt)}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div
                className="h-full w-full"
                style={{
                  backgroundImage:
                    "linear-gradient(120deg, color-mix(in srgb, var(--color-lode-500) 22%, transparent), transparent 60%)",
                }}
                aria-hidden
              />
            )}
            <div className="absolute -bottom-9 left-6">
              <div className="h-20 w-20 overflow-hidden rounded-full border-2 border-[color:var(--color-surface-1,#15181c)] bg-surface-3 shadow-lg">
                {avatar !== undefined ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={src("avatar", avatar.createdAt)}
                    alt={`${account.name}'s profile picture`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center font-display text-2xl text-lode-200">
                    {initial}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="px-6 pb-5 pt-12">
            <p className="font-display text-lg text-ink-100">{account.name}</p>
            <p className="text-[13px] text-ink-400">{account.email}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Panel eyebrow="Image" title="Profile picture">
            <ImageUploader kind="avatar" label="Profile picture" hasImage={avatar !== undefined} />
          </Panel>
          <Panel eyebrow="Image" title="Cover">
            <ImageUploader kind="cover" label="Cover image" hasImage={cover !== undefined} />
          </Panel>
        </div>
      </div>
    </main>
  );
}
