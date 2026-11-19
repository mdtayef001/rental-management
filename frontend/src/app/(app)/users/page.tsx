import { requireAccess } from "@/lib/auth/dal"
import { UsersView } from "./view"
import { pageTitle } from "@/lib/i18n/server"

export const generateMetadata = () => pageTitle("Team")

export default async function UsersPage() {
  await requireAccess("/users")
  return <UsersView />
}
