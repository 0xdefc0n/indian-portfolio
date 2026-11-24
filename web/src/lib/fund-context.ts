import { createContext, useContext } from "react"

import type { Holding } from "@/lib/api"

/** Opens the fund details dialog from anywhere a fund is listed. */
export const OpenFundContext = createContext<(h: Holding) => void>(() => {})
export const useOpenFund = () => useContext(OpenFundContext)
