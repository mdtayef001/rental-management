import Link from "next/link"
import { getT } from "@/lib/i18n/server"

export default async function NotFound() {
  const t = await getT()
  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="text-xl font-semibold">{t("Not here")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("That page doesn't exist, or the link has expired. Receipt links stop working once a rental is finished and archived.")}
        </p>
        <Link href="/" className="inline-block text-sm underline underline-offset-4">
          {t("Go back")}
        </Link>
      </div>
    </main>
  )
}
