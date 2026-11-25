// Avatar menu in the header (plan §13 item 8). Settings joins it with the Settings shell (M6).
import { LogOutIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { auth, type Me } from "@/lib/api"

export function AccountMenu({ me }: { me: Me }) {
  const [broken, setBroken] = useState(false)
  const label = me.user.name || me.user.email
  const initial = label.trim().charAt(0).toUpperCase() || "?"

  async function signOut() {
    try {
      await auth.signOut()
      window.location.assign("/login")
    } catch {
      toast.error("Couldn't sign out. Try again.")
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {me.user.image && !broken ? (
          <img src={me.user.image} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-8 rounded-full ring-1 ring-border" />
        ) : (
          <span className="grid size-8 place-items-center rounded-full bg-surface text-sm font-semibold ring-1 ring-border">{initial}</span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="grid gap-0.5 py-1.5">
          {me.user.name && <span className="truncate text-sm font-medium text-foreground">{me.user.name}</span>}
          <span className="truncate font-normal">{me.user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut} className="py-2">
          <LogOutIcon /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
